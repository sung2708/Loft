package realtime

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisBus is an ephemeral room-event relay. PostgreSQL and the Hub retain
// ownership of durable and active state; Pub/Sub is deliberately not replayable.
type RedisBus struct {
	client          *redis.Client
	instanceID      string
	logger          *slog.Logger
	cancel          context.CancelFunc
	wg              sync.WaitGroup
	lastRateWarning atomic.Int64
	ownerMu         sync.Mutex
	ownedRooms      map[string]string
	rpcMu           sync.Mutex
	pendingRPC      map[string]chan mediaRPCResponse
	rpcRequests     chan mediaRPCRequest
	mediaHandler    func(context.Context, mediaRPCRequest) mediaRPCResponse
	presenceHandler func(presenceReplacement)
	kickHandler     func(presenceKick)
}

// Redis TIME keeps the token bucket consistent even when application nodes
// have different clocks. The Lua script serializes reads and writes per key.
var rateBucketScript = redis.NewScript(`
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + tonumber(now[2]) / 1000
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local ttl_ms = tonumber(ARGV[3])
local values = redis.call('HMGET', KEYS[1], 'tokens', 'updated_ms')
local tokens = tonumber(values[1]) or capacity
local updated = tonumber(values[2]) or now_ms
tokens = math.min(capacity, tokens + math.max(0, now_ms - updated) * refill_per_ms)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_ms', now_ms)
redis.call('PEXPIRE', KEYS[1], ttl_ms)
return allowed
`)

// AllowRate enforces a shared token bucket. A failed Redis command returns an
// error; callers then use their bounded local limiter until Redis recovers.
func (b *RedisBus) AllowRate(ctx context.Context, category, identity string, events int, per time.Duration, burst int) (bool, error) {
	if category == "" || events <= 0 || per <= 0 || burst <= 0 {
		return false, fmt.Errorf("invalid distributed rate limit policy")
	}
	digest := sha256.Sum256([]byte(identity))
	key := fmt.Sprintf("ratelimit:%s:%x", category, digest)
	refillPerMS := float64(events) / float64(per.Milliseconds())
	ttl := max(time.Minute, 2*time.Duration(float64(per)*float64(burst)/float64(events)))
	result, err := rateBucketScript.Run(ctx, b.client, []string{key}, burst, refillPerMS, ttl.Milliseconds()).Int()
	if err != nil {
		if b.logger != nil {
			now := time.Now().Unix()
			last := b.lastRateWarning.Load()
			if now-last >= 30 && b.lastRateWarning.CompareAndSwap(last, now) {
				b.logger.Warn("redis rate limit unavailable; using local limiter", "error", err)
			}
		}
		return false, err
	}
	return result == 1, nil
}

type interNodeEvent struct {
	OriginInstanceID string `json:"origin_instance_id"`
	EventID          string `json:"event_id"`
	RoomID           string `json:"room_id"`
	Data             []byte `json:"data"`
}

func NewRedisBus(rawURL, instanceID string, logger *slog.Logger) (*RedisBus, error) {
	options, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	if instanceID == "" {
		instanceID = uuid.NewString()
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &RedisBus{client: redis.NewClient(options), instanceID: instanceID, logger: logger,
		ownedRooms: make(map[string]string), pendingRPC: make(map[string]chan mediaRPCResponse), rpcRequests: make(chan mediaRPCRequest, 128)}, nil
}

// Ping verifies the Redis dependency without mutating room state. It is used
// during bootstrap and readiness checks for features that cannot safely fall
// back to process-local coordination (for example OAuth state).
func (b *RedisBus) Ping(ctx context.Context) error {
	return b.client.Ping(ctx).Err()
}

func (b *RedisBus) Publish(ctx context.Context, roomID string, data []byte) error {
	payload, err := json.Marshal(interNodeEvent{OriginInstanceID: b.instanceID, EventID: uuid.NewString(), RoomID: roomID, Data: data})
	if err != nil {
		return err
	}
	return b.client.Publish(ctx, "room:"+roomID+":events", payload).Err()
}

func (b *RedisBus) Start(parent context.Context, deliver func(string, []byte)) {
	if b.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	b.cancel = cancel
	b.wg.Add(1)
	b.wg.Add(1)
	go b.renewOwners(ctx)
	for i := 0; i < 4; i++ {
		b.wg.Add(1)
		go b.rpcWorker(ctx)
	}
	go func() {
		defer b.wg.Done()
		backoff := time.Second
		for ctx.Err() == nil {
			pubsub := b.client.PSubscribe(ctx, "room:*:events", "instance:"+b.instanceID+":media_rpc", "instance:"+b.instanceID+":media_reply", "instance:"+b.instanceID+":presence_replace", "instance:"+b.instanceID+":presence_kick")
			for ctx.Err() == nil {
				message, err := pubsub.ReceiveMessage(ctx)
				if err != nil {
					b.logger.Warn("redis subscription unavailable; local realtime continues", "error", err)
					break
				}
				backoff = time.Second
				if message.Channel == "instance:"+b.instanceID+":media_rpc" {
					var request mediaRPCRequest
					if json.Unmarshal([]byte(message.Payload), &request) == nil && request.RequestID != "" && request.RoomID != "" {
						select {
						case b.rpcRequests <- request:
						default:
							b.logger.Warn("redis media RPC queue full", "room_id", request.RoomID)
						}
					}
					continue
				}
				if message.Channel == "instance:"+b.instanceID+":presence_replace" {
					var replacement presenceReplacement
					if json.Unmarshal([]byte(message.Payload), &replacement) == nil && replacement.RoomID != "" && replacement.ConnectionID != "" {
						b.rpcMu.Lock()
						handler := b.presenceHandler
						b.rpcMu.Unlock()
						if handler != nil {
							handler(replacement)
						}
					}
					continue
				}
				if message.Channel == "instance:"+b.instanceID+":presence_kick" {
					var kick presenceKick
					if json.Unmarshal([]byte(message.Payload), &kick) == nil && kick.RoomID != "" && kick.Identity != "" && kick.ConnectionID != "" {
						b.rpcMu.Lock()
						handler := b.kickHandler
						b.rpcMu.Unlock()
						if handler != nil {
							handler(kick)
						}
					}
					continue
				}
				if message.Channel == "instance:"+b.instanceID+":media_reply" {
					var reply mediaRPCResponse
					if json.Unmarshal([]byte(message.Payload), &reply) == nil {
						b.rpcMu.Lock()
						ch := b.pendingRPC[reply.RequestID]
						b.rpcMu.Unlock()
						if ch != nil {
							select {
							case ch <- reply:
							default:
							}
						}
					}
					continue
				}
				var packet interNodeEvent
				if json.Unmarshal([]byte(message.Payload), &packet) != nil || packet.OriginInstanceID == b.instanceID || packet.RoomID == "" || message.Channel != "room:"+packet.RoomID+":events" || len(packet.Data) > maxEventBytes {
					continue
				}
				deliver(packet.RoomID, packet.Data)
			}
			_ = pubsub.Close()
			if ctx.Err() != nil {
				return
			}
			timer := time.NewTimer(backoff)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}()
}

func (b *RedisBus) Close() {
	if b.cancel != nil {
		b.cancel()
	}
	b.wg.Wait()
	_ = b.client.Close()
}
