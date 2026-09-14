package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisBus is an ephemeral room-event relay. PostgreSQL and the Hub retain
// ownership of durable and active state; Pub/Sub is deliberately not replayable.
type RedisBus struct {
	client     *redis.Client
	instanceID string
	logger     *slog.Logger
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

func (b *RedisBus) RefreshPresence(ctx context.Context, roomID, identity, connectionID string) error {
	return b.client.Set(ctx, "presence:room:"+roomID+":"+identity+":"+connectionID, b.instanceID, 15*time.Second).Err()
}

func (b *RedisBus) ClearPresence(ctx context.Context, roomID, identity, connectionID string) error {
	return b.client.Del(ctx, "presence:room:"+roomID+":"+identity+":"+connectionID).Err()
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
	return &RedisBus{client: redis.NewClient(options), instanceID: instanceID, logger: logger}, nil
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
	go func() {
		defer b.wg.Done()
		backoff := time.Second
		for ctx.Err() == nil {
			pubsub := b.client.PSubscribe(ctx, "room:*:events")
			for ctx.Err() == nil {
				message, err := pubsub.ReceiveMessage(ctx)
				if err != nil {
					b.logger.Warn("redis subscription unavailable; local realtime continues", "error", err)
					break
				}
				var packet interNodeEvent
				if json.Unmarshal([]byte(message.Payload), &packet) != nil || packet.OriginInstanceID == b.instanceID || packet.RoomID == "" {
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
