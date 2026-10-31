package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"loft/backend/internal/domain"
)

type mediaAuthorityStub struct {
	commitErr   error
	ownerErr    error
	commitCalls int
	loaded      mediaState
	exists      bool
}

func (s *mediaAuthorityStub) Publish(context.Context, string, []byte) error { return nil }
func (s *mediaAuthorityStub) MediaOwner(context.Context, string) (bool, string, error) {
	return true, "stub", s.ownerErr
}
func (s *mediaAuthorityStub) LoadMedia(context.Context, string) (mediaState, bool, error) {
	return s.loaded, s.exists, nil
}
func (s *mediaAuthorityStub) InitializeMedia(context.Context, string, mediaState) (bool, error) {
	return true, nil
}
func (s *mediaAuthorityStub) CommitMedia(context.Context, string, uint64, mediaState, []byte) error {
	s.commitCalls++
	return s.commitErr
}
func (s *mediaAuthorityStub) ForwardMedia(context.Context, string, string, string, json.RawMessage, domain.Identity) error {
	return nil
}

func TestMediaMutationRollsBackWhenOwnerFenceFails(t *testing.T) {
	room := domain.Room{ID: "room", OwnerID: "host"}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	hub.SetBus(&mediaAuthorityStub{commitErr: ErrMediaOwnerLost})
	client := &client{id: "client", roomID: room.ID, send: make(chan []byte, 2)}
	if _, _, ok := hub.add(client, room); !ok {
		t.Fatal("client could not join")
	}
	payload, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/dQw4w9WgXcQ"})
	response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{
		RequestID: "request", RoomID: room.ID, Kind: "queue.add", Payload: payload,
		Actor: domain.Identity{ID: "host", Type: domain.IdentityUser},
	})
	if response.Error == "" {
		t.Fatal("fenced mutation unexpectedly succeeded")
	}
	hub.mu.RLock()
	state := hub.rooms[room.ID].media
	hub.mu.RUnlock()
	if state.Version != 0 || state.Current != nil || len(client.send) != 1 {
		t.Fatalf("uncommitted media leaked: state=%+v queued=%d", state, len(client.send))
	}
}

func TestRejectedMediaCommandRecoversAuthoritySnapshot(t *testing.T) {
	room := domain.Room{ID: "room", OwnerID: "host"}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	authoritative := mediaState{Status: "PAUSED", Version: 9, Queue: []youtubeTrack{}}
	hub.SetBus(&mediaAuthorityStub{commitErr: ErrMediaVersionChanged, loaded: authoritative, exists: true})
	client := &client{id: "client", roomID: room.ID, send: make(chan []byte, 2)}
	if _, _, ok := hub.add(client, room); !ok {
		t.Fatal("could not join")
	}
	payload, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/dQw4w9WgXcQ"})
	response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{
		RequestID: "request", RoomID: room.ID, Kind: "queue.add", Payload: payload,
		Actor: domain.Identity{ID: "host", Type: domain.IdentityUser},
	})
	if response.Error == "" {
		t.Fatal("stale command accepted")
	}
	hub.mu.RLock()
	version := hub.rooms[room.ID].media.Version
	hub.mu.RUnlock()
	if version != 9 {
		t.Fatalf("authority version not recovered: %d", version)
	}
	select {
	case data := <-client.send:
		var snapshot struct {
			Payload mediaState `json:"payload"`
		}
		if err := json.Unmarshal(data, &snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.Payload.Version != 9 || snapshot.Payload.Current != nil {
			t.Fatalf("incorrect recovery: %+v", snapshot.Payload)
		}
	default:
		t.Fatal("client did not receive recovery snapshot")
	}
}

func TestParseYouTubeID(t *testing.T) {
	for _, raw := range []string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?t=10",
		"https://m.youtube.com/shorts/dQw4w9WgXcQ",
	} {
		id, err := parseYouTubeID(raw)
		if err != nil || id != "dQw4w9WgXcQ" {
			t.Fatalf("valid URL rejected: %q: %v", raw, err)
		}
	}
	for _, raw := range []string{
		"http://youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
		"https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ",
		"https://youtube.com/watch?v=bad",
		"https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
	} {
		if _, err := parseYouTubeID(raw); err == nil {
			t.Fatalf("unsafe URL accepted: %q", raw)
		}
	}
}

func TestMediaConcurrentNextOnlyOneWins(t *testing.T) {
	room := domain.Room{OwnerID: "host"}
	host := domain.Identity{ID: "host", Type: domain.IdentityUser, DisplayName: "Host"}
	m := mediaState{Status: "PAUSED", Queue: []youtubeTrack{}}
	add := func(id string) {
		payload, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/" + id})
		if err := m.applyMedia("queue.add", payload, room, host, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	add("dQw4w9WgXcQ")
	add("M7lc1UVf-VE")
	startVersion := m.Version
	command, _ := json.Marshal(mediaCommand{ExpectedVersion: startVersion})
	var mu sync.Mutex
	var wg sync.WaitGroup
	success := 0
	stale := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			mu.Lock()
			err := m.applyMedia("queue.next", command, room, host, time.Now())
			mu.Unlock()
			if err == nil {
				mu.Lock()
				success++
				mu.Unlock()
			} else if err == errMediaStale {
				mu.Lock()
				stale++
				mu.Unlock()
			} else {
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()
	if success != 1 || stale != 19 || m.Current == nil || m.Current.VideoID != "M7lc1UVf-VE" {
		t.Fatalf("next race: success=%d stale=%d current=%+v", success, stale, m.Current)
	}
}

func TestMediaPermissionsAndReactionBurst(t *testing.T) {
	room := domain.Room{OwnerID: "host", AllowGuests: true, ID: "room"}
	guest := domain.Identity{ID: "guest", Type: domain.IdentityGuest, RoomID: "room", DisplayName: "Guest"}
	m := mediaState{Status: "IDLE", Queue: []youtubeTrack{}}
	add, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/dQw4w9WgXcQ"})
	if err := m.applyMedia("queue.add", add, room, guest, time.Now()); err != nil {
		t.Fatal(err)
	}
	play, _ := json.Marshal(mediaCommand{ExpectedVersion: m.Version})
	if err := m.applyMedia("media.play", play, room, guest, time.Now()); err != errMediaDenied {
		t.Fatalf("guest controlled media: %v", err)
	}
	state := &roomState{}
	now := time.Now()
	for i := 0; i < 20; i++ {
		if !state.allowReaction(now) {
			t.Fatalf("reaction %d unexpectedly rejected", i)
		}
	}
	if state.allowReaction(now) {
		t.Fatal("room burst limit failed")
	}
	if !state.allowReaction(now.Add(3 * time.Second)) {
		t.Fatal("reaction limit did not recover")
	}
}

func TestConcurrentQueueAddsPreserveEveryTrack(t *testing.T) {
	room := domain.Room{ID: "room", AllowGuests: true}
	media := mediaState{Status: "IDLE", Queue: []youtubeTrack{}}
	command, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/dQw4w9WgXcQ"})
	var lock sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lock.Lock()
			err := media.applyMedia("queue.add", command, room, domain.Identity{ID: "guest", Type: domain.IdentityGuest, RoomID: "room", DisplayName: "Guest"}, time.Now())
			lock.Unlock()
			if err != nil {
				t.Errorf("concurrent add: %v", err)
			}
		}()
	}
	wg.Wait()
	if media.Current == nil || len(media.Queue) != 19 || media.Version != 20 {
		t.Fatalf("lost queue additions: current=%v queue=%d version=%d", media.Current, len(media.Queue), media.Version)
	}
	snapshot := media.snapshot()
	snapshot.Queue[0].VideoID = "changed"
	if media.Queue[0].VideoID == "changed" {
		t.Fatal("snapshot shares queue backing array")
	}
}

func TestQueueSelectRemoveClearShuffle(t *testing.T) {
	room := domain.Room{ID: "room", OwnerID: "host", AllowGuests: true}
	host := domain.Identity{ID: "host", Type: domain.IdentityUser, DisplayName: "Host"}
	m := mediaState{Status: "IDLE", Queue: []youtubeTrack{}}

	// Add 3 tracks
	add1, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/dQw4w9WgXcQ", Title: "Track 1"})
	add2, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/M7lc1UVf-VE", Title: "Track 2"})
	add3, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/jNQXAC9IVRw", Title: "Track 3"})
	_ = m.applyMedia("queue.add", add1, room, host, time.Now())
	_ = m.applyMedia("queue.add", add2, room, host, time.Now())
	_ = m.applyMedia("queue.add", add3, room, host, time.Now())

	if m.Current == nil || m.Current.Title != "Track 1" || len(m.Queue) != 2 {
		t.Fatalf("unexpected state after adds: current=%+v queue=%d", m.Current, len(m.Queue))
	}

	track2ID := m.Queue[0].ID
	track3ID := m.Queue[1].ID

	// Test queue.select: select track 3 directly
	selectCmd, _ := json.Marshal(mediaCommand{ExpectedVersion: m.Version, TrackID: track3ID})
	if err := m.applyMedia("queue.select", selectCmd, room, host, time.Now()); err != nil {
		t.Fatalf("queue.select failed: %v", err)
	}
	if m.Current.ID != track3ID || len(m.Queue) != 1 || m.Queue[0].ID != track2ID {
		t.Fatalf("queue.select mismatch: current=%+v queue=%+v", m.Current, m.Queue)
	}

	// Test queue.select sets status to PLAYING
	if m.Status != "PLAYING" {
		t.Fatalf("expected PLAYING after queue.select, got %s", m.Status)
	}

	// Add another track
	add4, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/9bZkp7q19f0", Title: "Track 4"})
	_ = m.applyMedia("queue.add", add4, room, host, time.Now())
	add5, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/kJQP7kiw5Fk", Title: "Track 5"})
	_ = m.applyMedia("queue.add", add5, room, host, time.Now())

	// Test queue.reorder
	track4ID := m.Queue[1].ID
	track5ID := m.Queue[2].ID
	reorderCmd, _ := json.Marshal(mediaCommand{
		ExpectedVersion: m.Version,
		Order:           []string{track5ID, track4ID, track2ID},
	})
	if err := m.applyMedia("queue.reorder", reorderCmd, room, host, time.Now()); err != nil {
		t.Fatalf("queue.reorder failed: %v", err)
	}
	if m.Queue[0].ID != track5ID || m.Queue[1].ID != track4ID || m.Queue[2].ID != track2ID {
		t.Fatalf("queue.reorder mismatch: %+v", m.Queue)
	}

	// Test queue.next auto plays
	nextCmd, _ := json.Marshal(mediaCommand{ExpectedVersion: m.Version})
	if err := m.applyMedia("queue.next", nextCmd, room, host, time.Now()); err != nil {
		t.Fatalf("queue.next failed: %v", err)
	}
	if m.Current.ID != track5ID || m.Status != "PLAYING" {
		t.Fatalf("queue.next did not auto-play: current=%+v status=%s", m.Current, m.Status)
	}

	// Test queue.remove: remove track 2
	removeCmd, _ := json.Marshal(mediaCommand{ExpectedVersion: m.Version, TrackID: track2ID})
	if err := m.applyMedia("queue.remove", removeCmd, room, host, time.Now()); err != nil {
		t.Fatalf("queue.remove failed: %v", err)
	}
	if len(m.Queue) != 1 {
		t.Fatalf("queue.remove mismatch: queue=%+v", m.Queue)
	}

	// Test queue.clear
	clearCmd, _ := json.Marshal(mediaCommand{ExpectedVersion: m.Version})
	if err := m.applyMedia("queue.clear", clearCmd, room, host, time.Now()); err != nil {
		t.Fatalf("queue.clear failed: %v", err)
	}
	if len(m.Queue) != 0 {
		t.Fatalf("queue.clear mismatch: queue=%+v", m.Queue)
	}
}

func TestMediaReorderRejectsDuplicateIDs(t *testing.T) {
	room := domain.Room{ID: "room", OwnerID: "host"}
	host := domain.Identity{ID: "host", Type: domain.IdentityUser}
	m := mediaState{Status: "PLAYING", Current: &youtubeTrack{ID: "current", VideoID: "dQw4w9WgXcQ"}, Queue: []youtubeTrack{{ID: "a"}, {ID: "b"}}}
	command, _ := json.Marshal(mediaCommand{Order: []string{"a", "a"}})
	if err := m.applyMedia("queue.reorder", command, room, host, time.Now()); err != errInvalidMedia {
		t.Fatalf("duplicate order accepted: %v", err)
	}
	if m.Queue[0].ID != "a" || m.Queue[1].ID != "b" || m.Version != 0 {
		t.Fatalf("invalid reorder mutated queue: %+v", m.Queue)
	}
}

func TestMediaFinishAndSharedRepeat(t *testing.T) {
	now := time.Now().UTC()
	m := mediaState{Current: &youtubeTrack{ID: "a", DurationSec: 2}, Queue: []youtubeTrack{{ID: "b"}}, Status: "PLAYING", StartedAt: now.Add(-3 * time.Second)}
	if !m.finish(now) || m.Current.ID != "b" || m.Status != "PLAYING" || m.Version != 1 {
		t.Fatalf("end did not advance: %+v", m)
	}
	m.Current.DurationSec = 2
	m.Repeat = true
	m.StartedAt = now.Add(-3 * time.Second)
	if !m.finish(now) || m.Current.ID != "b" || m.PositionMs != 0 || m.Version != 2 {
		t.Fatalf("repeat did not restart track: %+v", m)
	}
	m.Status = "PAUSED"
	if m.finish(now.Add(3 * time.Second)) {
		t.Fatal("paused media advanced")
	}
}

func TestMediaControlCommandsRequireHost(t *testing.T) {
	room := domain.Room{ID: "room", OwnerID: "host", AllowGuests: true}
	guest := domain.Identity{ID: "guest", Type: domain.IdentityGuest, RoomID: room.ID}
	member := domain.Identity{ID: "member", Type: domain.IdentityUser}
	m := mediaState{Current: &youtubeTrack{ID: "a", VideoID: "dQw4w9WgXcQ"}, Queue: []youtubeTrack{{ID: "b"}}, Status: "PLAYING", StartedAt: time.Now()}
	for _, actor := range []domain.Identity{guest, member} {
		for _, kind := range []string{"media.seek", "media.play", "media.play_now", "media.restart", "media.duration", "media.repeat", "queue.next", "queue.select", "queue.remove", "queue.clear", "queue.shuffle", "queue.reorder", "media.autoplay.set"} {
			command, _ := json.Marshal(mediaCommand{ExpectedVersion: m.Version, TrackID: "b", VideoID: m.Current.VideoID, DurationSec: 30})
			if err := m.applyMedia(kind, command, room, actor, time.Now()); err != errMediaDenied {
				t.Fatalf("%s allowed for %s: %v", kind, actor.Type, err)
			}
		}
	}
	if m.Version != 0 || m.Current.ID != "a" {
		t.Fatalf("denied command changed media: %+v", m)
	}
}

func TestMediaRejectsCommandsDuringCoordinatorOutage(t *testing.T) {
	for _, commitFailure := range []bool{false, true} {
		room := domain.Room{ID: "room", OwnerID: "host"}
		hub := New(&realtimeStore{room: room}, nil, nil, nil, nil)
		authority := &mediaAuthorityStub{}
		if commitFailure {
			authority.commitErr = errors.New("commit unavailable")
		} else {
			authority.ownerErr = errors.New("coordinator unavailable")
		}
		hub.SetBus(authority)
		hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "IDLE"}}
		response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "media.play_now", Payload: json.RawMessage(`{"url":"https://youtu.be/dQw4w9WgXcQ"}`), Actor: domain.Identity{ID: "host", Type: domain.IdentityUser}})
		if response.Error == "" || hub.rooms[room.ID].media.Current != nil || hub.rooms[room.ID].media.Version != 0 {
			t.Fatal("uncommitted playback accepted during outage")
		}
	}
}

func TestReplayStartsPausedTrackWithoutChangingQueue(t *testing.T) {
	now := time.Now().UTC()
	room := domain.Room{ID: "room", OwnerID: "owner"}
	media := mediaState{Current: &youtubeTrack{ID: "current", VideoID: "dQw4w9WgXcQ"}, Queue: []youtubeTrack{{ID: "next"}}, Status: "PAUSED", PositionMs: 42000, Version: 3}
	payload, _ := json.Marshal(mediaCommand{ExpectedVersion: 3})
	if err := media.applyMedia("media.restart", payload, room, domain.Identity{ID: "owner", Type: domain.IdentityUser}, now); err != nil {
		t.Fatal(err)
	}
	if media.Status != "PLAYING" || media.PositionMs != 0 || !media.StartedAt.Equal(now) || media.Current.ID != "current" || len(media.Queue) != 1 || media.Version != 4 {
		t.Fatalf("incorrect replay: %+v", media)
	}
	if err := media.applyMedia("media.restart", payload, room, domain.Identity{ID: "owner", Type: domain.IdentityUser}, now); err != errMediaStale {
		t.Fatalf("stale replay accepted: %v", err)
	}
}

func TestLateDurationReportDoesNotRejectOrMutateNewTrack(t *testing.T) {
	room := domain.Room{ID: "room", OwnerID: "owner"}
	actor := domain.Identity{ID: "owner", Type: domain.IdentityUser}
	media := mediaState{Current: &youtubeTrack{ID: "new", VideoID: "M7lc1UVf-VE", DurationSec: 60}, Status: "PLAYING", Version: 3}
	for _, command := range []mediaCommand{
		{VideoID: "dQw4w9WgXcQ", DurationSec: 300, ExpectedVersion: 3},
		{VideoID: "M7lc1UVf-VE", DurationSec: 300, ExpectedVersion: 2},
		{VideoID: "M7lc1UVf-VE", DurationSec: 60, ExpectedVersion: 3},
	} {
		payload, _ := json.Marshal(command)
		if err := media.applyMedia("media.duration", payload, room, actor, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if media.Version != 3 || media.Current.DurationSec != 60 {
		t.Fatalf("late report mutated track: %+v", media)
	}
}

type blockedMediaAuthority struct {
	mediaAuthorityStub
	entered chan struct{}
	resume  chan struct{}
}

func (b *blockedMediaAuthority) CommitMedia(ctx context.Context, _ string, _ uint64, _ mediaState, _ []byte) error {
	close(b.entered)
	select {
	case <-b.resume:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func TestSnapshotsDoNotExposeMediaBeforeCoordinatorCommit(t *testing.T) {
	room := domain.Room{ID: "pending", OwnerID: "owner"}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	bus := &blockedMediaAuthority{entered: make(chan struct{}), resume: make(chan struct{})}
	hub.SetBus(bus)
	hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "IDLE"}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan mediaRPCResponse, 1)
	go func() {
		done <- hub.handleForwardedMedia(ctx, mediaRPCRequest{RoomID: room.ID, Kind: "queue.add", Payload: json.RawMessage(`{"url":"https://youtu.be/dQw4w9WgXcQ"}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
	}()
	select {
	case <-bus.entered:
	case <-ctx.Done():
		t.Fatal("commit did not start")
	}
	hub.mu.RLock()
	pending := hub.rooms[room.ID].media.snapshot()
	hub.mu.RUnlock()
	close(bus.resume)
	result := <-done
	if pending.Version != 0 || pending.Current != nil || result.Error != "" {
		t.Fatalf("pending commit leaked into snapshots: %+v %+v", pending, result)
	}
	hub.mu.RLock()
	committed := hub.rooms[room.ID].media.snapshot()
	hub.mu.RUnlock()
	if committed.Version != 1 || committed.Current == nil {
		t.Fatal("committed state not installed")
	}
}
