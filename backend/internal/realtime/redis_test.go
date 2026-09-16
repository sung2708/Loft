package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"loft/backend/internal/domain"
)

type memoryBus struct {
	instanceID string
	peers      []*memoryBus
	deliver    func(string, []byte)
}

func (m *memoryBus) Publish(_ context.Context, roomID string, data []byte) error {
	packet, err := json.Marshal(interNodeEvent{
		OriginInstanceID: m.instanceID,
		EventID:          uuid.NewString(),
		RoomID:           roomID,
		Data:             data,
	})
	if err != nil {
		return err
	}

	for _, peer := range m.peers {
		var incoming interNodeEvent
		if err := json.Unmarshal(packet, &incoming); err != nil {
			continue
		}
		// Origin filtering: origin instance must ignore its own events
		if incoming.OriginInstanceID == peer.instanceID {
			continue
		}
		if peer.deliver != nil {
			peer.deliver(incoming.RoomID, incoming.Data)
		}
	}
	return nil
}

func TestTwoHubAppearanceDeliveryAndOriginFiltering(t *testing.T) {
	roomID := uuid.NewString()
	initialRoom := domain.NormalizeRoomAppearance(domain.Room{ID: roomID, Version: 1})

	storeA := &realtimeStore{room: initialRoom}
	storeB := &realtimeStore{room: initialRoom}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hubA := New(storeA, nil, nil, nil, logger)
	hubB := New(storeB, nil, nil, nil, logger)

	hubA.rooms[roomID] = &roomState{room: initialRoom, clients: map[string]*client{}}
	hubB.rooms[roomID] = &roomState{room: initialRoom, clients: map[string]*client{}}

	busA := &memoryBus{instanceID: "instance-A"}
	busB := &memoryBus{instanceID: "instance-B"}

	busA.peers = []*memoryBus{busA, busB}
	busB.peers = []*memoryBus{busA, busB}

	busA.deliver = hubA.DeliverRemote
	busB.deliver = hubB.DeliverRemote

	hubA.SetBus(busA)
	hubB.SetBus(busB)

	// Hub A commits and broadcasts an appearance update
	appearanceUpdate := roomAppearanceUpdatedPayload{
		Atmosphere:              domain.AtmosphereParty,
		Accent:                  domain.AccentRose,
		AdaptiveMediaBackground: false,
		Version:                 2,
	}
	eventBytes := event("room.appearance.updated", roomID, appearanceUpdate)

	// 1. Hub A broadcasts
	if err := busA.Publish(context.Background(), roomID, eventBytes); err != nil {
		t.Fatalf("busA publish: %v", err)
	}

	// 2. Verify Hub B receives and updates local projection
	hubB.mu.RLock()
	stateB := hubB.rooms[roomID].room
	hubB.mu.RUnlock()

	if stateB.Version != 2 || stateB.Atmosphere != domain.AtmosphereParty || stateB.Accent != domain.AccentRose || stateB.AdaptiveMediaBackground {
		t.Fatalf("Hub B did not receive updated appearance: %+v", stateB)
	}

	// 3. Idempotence: Duplicate event should not corrupt or error
	hubB.DeliverRemote(roomID, eventBytes)
	hubB.mu.RLock()
	stateB2 := hubB.rooms[roomID].room
	hubB.mu.RUnlock()
	if stateB2.Version != 2 || stateB2.Atmosphere != domain.AtmosphereParty {
		t.Fatalf("Duplicate event altered state: %+v", stateB2)
	}

	// 4. Out-of-order older event must be ignored
	staleUpdate := roomAppearanceUpdatedPayload{
		Atmosphere:              domain.AtmosphereMinimal,
		Accent:                  domain.AccentBlue,
		AdaptiveMediaBackground: true,
		Version:                 1,
	}
	staleBytes := event("room.appearance.updated", roomID, staleUpdate)
	hubB.DeliverRemote(roomID, staleBytes)

	hubB.mu.RLock()
	stateB3 := hubB.rooms[roomID].room
	hubB.mu.RUnlock()
	if stateB3.Version != 2 || stateB3.Atmosphere != domain.AtmosphereParty {
		t.Fatalf("Older version event overwrote newer version: %+v", stateB3)
	}

	// 5. Payload hygiene: Verify event contains no arbitrary styling, CSS, URLs, or personal theme
	var env Envelope
	if err := json.Unmarshal(eventBytes, &env); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	raw := string(env.Payload)
	forbidden := []string{"<style>", "http://", "https://", "css", "style", "palette", "artwork", "loft.theme", "theme", "light", "dark", "system"}
	for _, f := range forbidden {
		if stringContainsInsensitive(raw, `"`+f+`"`) {
			t.Fatalf("appearance event contained forbidden attribute %q: %s", f, raw)
		}
	}
}

type failingBus struct{}

func (f *failingBus) Publish(context.Context, string, []byte) error {
	return context.DeadlineExceeded
}

func TestRedisOutageDoesNotBreakLocalRealtime(t *testing.T) {
	roomID := uuid.NewString()
	room := domain.NormalizeRoomAppearance(domain.Room{ID: roomID, Version: 1})
	store := &realtimeStore{room: room}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := New(store, nil, nil, nil, logger)

	clientChan := make(chan []byte, 10)
	c := &client{id: "local-client", send: clientChan, roomID: roomID}
	hub.rooms[roomID] = &roomState{room: room, clients: map[string]*client{"local-client": c}}

	// Attach failing bus (simulating Redis outage)
	hub.SetBus(&failingBus{})

	// Local broadcast should succeed even if bus publish returns error
	appearanceUpdate := roomAppearanceUpdatedPayload{
		Atmosphere:              domain.AtmosphereFocus,
		Accent:                  domain.AccentGreen,
		AdaptiveMediaBackground: true,
		Version:                 2,
	}
	eventBytes := event("room.appearance.updated", roomID, appearanceUpdate)

	hub.broadcast(roomID, eventBytes, "")

	select {
	case msg := <-clientChan:
		var env Envelope
		if err := json.Unmarshal(msg, &env); err != nil || env.Type != "room.appearance.updated" {
			t.Fatalf("unexpected message: %s", string(msg))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("local client did not receive broadcast during Redis outage")
	}
}

func TestLiveRedisBusMultiInstance(t *testing.T) {
	if os.Getenv("LOFT_RELEASE_REDIS_TEST") != "1" {
		t.Skip("set LOFT_RELEASE_REDIS_TEST=1 for live redis multi-instance test")
	}
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://127.0.0.1:6379"
	}
	busA, err := NewRedisBus(redisURL, "inst-A", nil)
	if err != nil {
		t.Fatalf("connecting busA: %v", err)
	}
	defer busA.Close()

	busB, err := NewRedisBus(redisURL, "inst-B", nil)
	if err != nil {
		t.Fatalf("connecting busB: %v", err)
	}
	defer busB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	received := make(chan []byte, 1)
	busB.Start(ctx, func(_ string, data []byte) {
		select {
		case received <- data:
		default:
		}
	})

	time.Sleep(100 * time.Millisecond)

	roomID := uuid.NewString()
	testPayload := []byte(`{"type":"room.appearance.updated","payload":{"atmosphere":"party"}}`)
	if err := busA.Publish(ctx, roomID, testPayload); err != nil {
		t.Fatalf("publish error: %v", err)
	}

	select {
	case data := <-received:
		if string(data) != string(testPayload) {
			t.Fatalf("unexpected data: %s", string(data))
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for live Redis message")
	}
}

func stringContainsInsensitive(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}
