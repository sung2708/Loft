package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"loft/backend/internal/domain"
)

var (
	ErrMediaOwnerLost      = errors.New("media room owner changed")
	ErrMediaVersionChanged = errors.New("media version changed")
	ErrMediaOwnerBusy      = errors.New("media room owner unavailable")
)

type mediaRPCRequest struct {
	RequestID string          `json:"request_id"`
	OriginID  string          `json:"origin_id"`
	RoomID    string          `json:"room_id"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	Actor     domain.Identity `json:"actor"`
}

type mediaRPCResponse struct {
	RequestID string `json:"request_id"`
	Error     string `json:"error,omitempty"`
}

var ensureOwnerScript = redis.NewScript(`
local current = redis.call('GET', KEYS[1])
if current and current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
  return current
end
if not current then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]), 'NX')
  current = redis.call('GET', KEYS[1])
end
return current
`)

var initializeMediaScript = redis.NewScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'lost' end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'exists' end
redis.call('SET', KEYS[2], ARGV[2], 'PX', tonumber(ARGV[3]))
return 'ok'
`)

var commitMediaScript = redis.NewScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'lost' end
local raw = redis.call('GET', KEYS[2])
if not raw then return 'stale' end
local current = cjson.decode(raw)
if tonumber(current.version) ~= tonumber(ARGV[2]) then return 'stale' end
redis.call('SET', KEYS[2], ARGV[3], 'PX', tonumber(ARGV[5]))
redis.call('PUBLISH', KEYS[3], ARGV[4])
return 'ok'
`)

func mediaOwnerKey(roomID string) string { return "lease:room:" + roomID + ":media_owner" }
func mediaCacheKey(roomID string) string { return "room:" + roomID + ":media_snapshot" }

// MediaOwner returns the fenced owner token. Only a matching token may commit.
func (b *RedisBus) MediaOwner(ctx context.Context, roomID string) (bool, string, error) {
	b.ownerMu.Lock()
	old := b.ownedRooms[roomID]
	b.ownerMu.Unlock()
	proposed := b.instanceID + ":" + uuid.NewString()
	value, err := ensureOwnerScript.Run(ctx, b.client, []string{mediaOwnerKey(roomID)}, old, proposed, (30 * time.Second).Milliseconds()).Text()
	if err != nil {
		return false, "", err
	}
	// Ownership is fenced by the opaque lease token, not only by the instance
	// label. A process restart with a reused INSTANCE_ID must not adopt a live
	// lease held by its predecessor while that predecessor may still be serving.
	isOwner := value == proposed || (old != "" && value == old)
	b.ownerMu.Lock()
	if isOwner {
		b.ownedRooms[roomID] = value
	} else {
		delete(b.ownedRooms, roomID)
	}
	b.ownerMu.Unlock()
	return isOwner, strings.SplitN(value, ":", 2)[0], nil
}

func (b *RedisBus) LoadMedia(ctx context.Context, roomID string) (mediaState, bool, error) {
	raw, err := b.client.Get(ctx, mediaCacheKey(roomID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return mediaState{}, false, nil
	}
	if err != nil {
		return mediaState{}, false, err
	}
	var state mediaState
	if err := json.Unmarshal(raw, &state); err != nil {
		return mediaState{}, false, err
	}
	return state.snapshot(), true, nil
}

// InitializeMedia seeds an empty or flushed cache with a safe Go-generated
// state. It cannot overwrite another owner or an existing versioned snapshot.
func (b *RedisBus) InitializeMedia(ctx context.Context, roomID string, state mediaState) (bool, error) {
	b.ownerMu.Lock()
	token := b.ownedRooms[roomID]
	b.ownerMu.Unlock()
	if token == "" {
		return false, ErrMediaOwnerLost
	}
	data, err := json.Marshal(state)
	if err != nil {
		return false, err
	}
	result, err := initializeMediaScript.Run(ctx, b.client, []string{mediaOwnerKey(roomID), mediaCacheKey(roomID)}, token, data, (20 * time.Minute).Milliseconds()).Text()
	if err != nil {
		return false, err
	}
	switch result {
	case "ok":
		return true, nil
	case "exists":
		return false, nil
	default:
		return false, ErrMediaOwnerLost
	}
}

// CommitMedia atomically fences the writer, compares the prior version, stores
// a short-lived failover snapshot, and publishes the resulting event.
func (b *RedisBus) CommitMedia(ctx context.Context, roomID string, previous uint64, state mediaState, eventData []byte) error {
	b.ownerMu.Lock()
	token := b.ownedRooms[roomID]
	b.ownerMu.Unlock()
	if token == "" {
		return ErrMediaOwnerLost
	}
	snapshot, err := json.Marshal(state)
	if err != nil {
		return err
	}
	packet, err := json.Marshal(interNodeEvent{OriginInstanceID: b.instanceID, EventID: uuid.NewString(), RoomID: roomID, Data: eventData})
	if err != nil {
		return err
	}
	result, err := commitMediaScript.Run(ctx, b.client, []string{mediaOwnerKey(roomID), mediaCacheKey(roomID), "room:" + roomID + ":events"}, token, previous, snapshot, packet, (20 * time.Minute).Milliseconds()).Text()
	if err != nil {
		return err
	}
	switch result {
	case "ok":
		return nil
	case "stale":
		return ErrMediaVersionChanged
	default:
		return ErrMediaOwnerLost
	}
}

func (b *RedisBus) SetMediaHandler(handler func(context.Context, mediaRPCRequest) mediaRPCResponse) {
	b.rpcMu.Lock()
	b.mediaHandler = handler
	b.rpcMu.Unlock()
}

func (b *RedisBus) ForwardMedia(ctx context.Context, owner, roomID, kind string, payload json.RawMessage, actor domain.Identity) error {
	if owner == "" || owner == b.instanceID {
		return ErrMediaOwnerBusy
	}
	request := mediaRPCRequest{RequestID: uuid.NewString(), OriginID: b.instanceID, RoomID: roomID, Kind: kind, Payload: payload, Actor: actor}
	data, err := json.Marshal(request)
	if err != nil {
		return err
	}
	response := make(chan mediaRPCResponse, 1)
	b.rpcMu.Lock()
	if len(b.pendingRPC) >= 128 {
		b.rpcMu.Unlock()
		return ErrMediaOwnerBusy
	}
	b.pendingRPC[request.RequestID] = response
	b.rpcMu.Unlock()
	defer func() { b.rpcMu.Lock(); delete(b.pendingRPC, request.RequestID); b.rpcMu.Unlock() }()
	if err := b.client.Publish(ctx, "instance:"+owner+":media_rpc", data).Err(); err != nil {
		return err
	}
	select {
	case reply := <-response:
		if reply.Error != "" {
			return errors.New(reply.Error)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *RedisBus) rpcWorker(ctx context.Context) {
	defer b.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case request := <-b.rpcRequests:
			b.rpcMu.Lock()
			handler := b.mediaHandler
			b.rpcMu.Unlock()
			reply := mediaRPCResponse{RequestID: request.RequestID}
			if handler == nil {
				reply.Error = ErrMediaOwnerBusy.Error()
			} else {
				workCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
				reply = handler(workCtx, request)
				cancel()
				reply.RequestID = request.RequestID
			}
			if request.OriginID == "" {
				continue
			}
			data, err := json.Marshal(reply)
			if err != nil {
				continue
			}
			publishCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
			if err := b.client.Publish(publishCtx, "instance:"+request.OriginID+":media_reply", data).Err(); err != nil {
				b.logger.Warn("redis media RPC reply failed", "room_id", request.RoomID, "error", err)
			}
			cancel()
		}
	}
}

func (b *RedisBus) renewOwners(ctx context.Context) {
	defer b.wg.Done()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.ownerMu.Lock()
			rooms := make([]string, 0, len(b.ownedRooms))
			for roomID := range b.ownedRooms {
				rooms = append(rooms, roomID)
			}
			b.ownerMu.Unlock()
			for _, roomID := range rooms {
				checkCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
				owner, _, err := b.MediaOwner(checkCtx, roomID)
				if owner {
					_ = b.client.Expire(checkCtx, mediaCacheKey(roomID), 20*time.Minute).Err()
				}
				cancel()
				if err != nil && b.logger != nil {
					b.logger.Warn("redis media owner renewal failed", "room_id", roomID, "error", err)
				}
			}
		}
	}
}

func (b *RedisBus) ReleaseMediaOwner(ctx context.Context, roomID string) error {
	b.ownerMu.Lock()
	token := b.ownedRooms[roomID]
	delete(b.ownedRooms, roomID)
	b.ownerMu.Unlock()
	if token == "" {
		return nil
	}
	result, err := redis.NewScript(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`).Run(ctx, b.client, []string{mediaOwnerKey(roomID)}, token).Int()
	_ = result
	return err
}

func (b *RedisBus) ValidateMediaOwner(ctx context.Context, roomID string) error {
	owner, _, err := b.MediaOwner(ctx, roomID)
	if err != nil {
		return err
	}
	if !owner {
		return fmt.Errorf("%w: %s", ErrMediaOwnerLost, roomID)
	}
	return nil
}
