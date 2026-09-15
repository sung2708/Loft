package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/redis/go-redis/v9"
	"loft/backend/internal/domain"
)

var (
	ErrDistributedRoomFull         = errors.New("distributed room capacity reached")
	ErrDistributedDuplicateSession = errors.New("identity is active in another tab")
	ErrDistributedStaleSession     = errors.New("presence lease was replaced by a newer connection")
)

const presenceTTL = 15 * time.Second

type presenceLease struct {
	ConnectionID string             `json:"connection_id"`
	TabSessionID string             `json:"tab_session_id"`
	InstanceID   string             `json:"instance_id"`
	ExpiresMS    int64              `json:"expires_ms"`
	Participant  domain.Participant `json:"participant"`
}

type presenceReplacement struct {
	RoomID       string `json:"room_id"`
	Identity     string `json:"identity"`
	ConnectionID string `json:"connection_id"`
}

type presenceKick struct {
	RoomID       string `json:"room_id"`
	Identity     string `json:"identity"`
	ConnectionID string `json:"connection_id"`
}

type presenceAdmissionResult struct {
	Participant          domain.Participant `json:"participant"`
	ReplacedInstanceID   string             `json:"replaced_instance_id,omitempty"`
	ReplacedConnectionID string             `json:"replaced_connection_id,omitempty"`
}

// Every admission and heartbeat prunes expired members atomically. The hash
// itself expires, while per-member deadlines prevent stale capacity claims.
var admitPresenceScript = redis.NewScript(`
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + tonumber(now[2]) / 1000
local entries = redis.call('HGETALL', KEYS[1])
local count = 0
local existing = nil
for i = 1, #entries, 2 do
  local item = cjson.decode(entries[i + 1])
  if tonumber(item.expires_ms) <= now_ms then
    redis.call('HDEL', KEYS[1], entries[i])
  else
    count = count + 1
    if entries[i] == ARGV[1] then existing = item end
  end
end
if existing ~= nil then
  if existing.tab_session_id ~= ARGV[2] then return 'duplicate' end
  if existing.connection_id ~= ARGV[3] and ARGV[7] ~= '1' then return 'stale' end
elseif count >= tonumber(ARGV[4]) then
  return 'full'
end
local lease = cjson.decode(ARGV[5])
if existing ~= nil then
  lease.participant.connection_id = existing.participant.connection_id
  lease.participant.joined_at = existing.participant.joined_at
end
lease.expires_ms = now_ms + tonumber(ARGV[6])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(lease))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[6]) * 2)
local response = { participant = lease.participant }
if existing ~= nil and existing.connection_id ~= ARGV[3] then
  response.replaced_instance_id = existing.instance_id
  response.replaced_connection_id = existing.connection_id
end
return cjson.encode(response)
`)

var releasePresenceScript = redis.NewScript(`
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local lease = cjson.decode(raw)
if lease.connection_id ~= ARGV[2] then return 0 end
return redis.call('HDEL', KEYS[1], ARGV[1])
`)

var hasPresenceScript = redis.NewScript(`
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + tonumber(now[2]) / 1000
local lease = cjson.decode(raw)
if tonumber(lease.expires_ms) <= now_ms then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 0
end
return 1
`)

var hasPresenceTabScript = redis.NewScript(`
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + tonumber(now[2]) / 1000
local lease = cjson.decode(raw)
if tonumber(lease.expires_ms) <= now_ms then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 0
end
if lease.tab_session_id == ARGV[2] then return 1 end
return 0
`)

func presenceRoomKey(roomID string) string { return "presence:room:" + roomID + ":members" }

func (b *RedisBus) SetPresenceReplacementHandler(handler func(presenceReplacement)) {
	b.rpcMu.Lock()
	b.presenceHandler = handler
	b.rpcMu.Unlock()
}

func (b *RedisBus) SetPresenceKickHandler(handler func(presenceKick)) {
	b.rpcMu.Lock()
	b.kickHandler = handler
	b.rpcMu.Unlock()
}

// AdmitPresence is the cross-node admission gate. Redis failure is surfaced to
// the caller so it may use the local Hub policy in degraded single-node mode.
func (b *RedisBus) AdmitPresence(ctx context.Context, roomID, identity, tabSessionID, connectionID string, participant domain.Participant, maxParticipants int, replace bool) (domain.Participant, error) {
	if maxParticipants <= 0 {
		maxParticipants = 12
	}
	lease := presenceLease{ConnectionID: connectionID, TabSessionID: tabSessionID, InstanceID: b.instanceID, Participant: participant}
	payload, err := json.Marshal(lease)
	if err != nil {
		return domain.Participant{}, err
	}
	allowReplace := "0"
	if replace {
		allowReplace = "1"
	}
	result, err := admitPresenceScript.Run(ctx, b.client, []string{presenceRoomKey(roomID)}, identity, tabSessionID, connectionID, maxParticipants, payload, presenceTTL.Milliseconds(), allowReplace).Text()
	if err != nil {
		return domain.Participant{}, err
	}
	switch result {
	case "duplicate":
		return domain.Participant{}, ErrDistributedDuplicateSession
	case "full":
		return domain.Participant{}, ErrDistributedRoomFull
	case "stale":
		return domain.Participant{}, ErrDistributedStaleSession
	}
	var response presenceAdmissionResult
	if err := json.Unmarshal([]byte(result), &response); err != nil || response.Participant.ConnectionID == "" {
		return domain.Participant{}, errors.New("invalid Redis admission response")
	}
	if response.ReplacedInstanceID != "" && response.ReplacedInstanceID != b.instanceID {
		replacement := presenceReplacement{RoomID: roomID, Identity: identity, ConnectionID: response.ReplacedConnectionID}
		data, marshalErr := json.Marshal(replacement)
		if marshalErr == nil {
			notifyCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
			if publishErr := b.client.Publish(notifyCtx, "instance:"+response.ReplacedInstanceID+":presence_replace", data).Err(); publishErr != nil && b.logger != nil {
				b.logger.Warn("redis presence replacement notification failed", "room_id", roomID, "error", publishErr)
			}
			cancel()
		}
	}
	return response.Participant, nil
}

// ReleasePresence only removes the exact connection lease. A stale reload
// cleanup cannot delete the replacement lease for the same identity.
func (b *RedisBus) ReleasePresence(ctx context.Context, roomID, identity, connectionID string) error {
	return releasePresenceScript.Run(ctx, b.client, []string{presenceRoomKey(roomID)}, identity, connectionID).Err()
}

func (b *RedisBus) RemoveAdmission(ctx context.Context, roomID, identity string) error {
	return b.client.HDel(ctx, presenceRoomKey(roomID), identity).Err()
}

func (b *RedisBus) HasAdmission(ctx context.Context, roomID, identity string) (bool, error) {
	result, err := hasPresenceScript.Run(ctx, b.client, []string{presenceRoomKey(roomID)}, identity).Int()
	return result == 1, err
}

// HasPresenceForTab checks whether a live lease belongs to the same browser
// tab. It is read-only and lets a locked room preserve reconnects without
// allowing a new guest identity through the lock gate.
func (b *RedisBus) HasPresenceForTab(ctx context.Context, roomID, identity, tabSessionID string) (bool, error) {
	if tabSessionID == "" {
		return false, nil
	}
	result, err := hasPresenceTabScript.Run(ctx, b.client, []string{presenceRoomKey(roomID)}, identity, tabSessionID).Int()
	return result == 1, err
}

// FindPresenceByConnection returns the current lease that owns a participant
// connection ID. The instance ID lets a host route an eviction to the node
// that owns the socket; the durable ban is written separately by PostgreSQL.
func (b *RedisBus) FindPresenceByConnection(ctx context.Context, roomID, connectionID string) (presenceLease, bool, error) {
	entries, err := b.client.HGetAll(ctx, presenceRoomKey(roomID)).Result()
	if err != nil {
		return presenceLease{}, false, err
	}
	now := time.Now().UnixMilli()
	for _, raw := range entries {
		var lease presenceLease
		if json.Unmarshal([]byte(raw), &lease) != nil || lease.ConnectionID != connectionID || lease.ExpiresMS <= now {
			continue
		}
		return lease, true, nil
	}
	return presenceLease{}, false, nil
}

func (b *RedisBus) PublishPresenceKick(ctx context.Context, instanceID string, kick presenceKick) error {
	if instanceID == "" {
		return errors.New("missing presence target instance")
	}
	data, err := json.Marshal(kick)
	if err != nil {
		return err
	}
	return b.client.Publish(ctx, "instance:"+instanceID+":presence_kick", data).Err()
}

func (b *RedisBus) ListPresence(ctx context.Context, roomID string) ([]domain.Participant, error) {
	entries, err := b.client.HGetAll(ctx, presenceRoomKey(roomID)).Result()
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	participants := make([]domain.Participant, 0, len(entries))
	for _, raw := range entries {
		var lease presenceLease
		if json.Unmarshal([]byte(raw), &lease) != nil || lease.ExpiresMS <= now {
			continue
		}
		participants = append(participants, lease.Participant)
	}
	sort.Slice(participants, func(i, j int) bool { return participants[i].JoinedAt.Before(participants[j].JoinedAt) })
	return participants, nil
}
