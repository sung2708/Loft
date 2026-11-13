package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"loft/backend/internal/domain"
)

func TestSkipVoteNeedsMajorityAndIgnoresStaleTracks(t *testing.T) {
	room := domain.Room{ID: "room", AllowGuests: true, OwnerID: "owner"}
	guest := func(id string) domain.Identity {
		return domain.Identity{ID: id, Type: domain.IdentityGuest, RoomID: room.ID}
	}
	listeners := []domain.Participant{{LiveKitIdentity: guest("a").LiveKitIdentity()}, {LiveKitIdentity: guest("b").LiveKitIdentity()}, {LiveKitIdentity: guest("c").LiveKitIdentity()}, {LiveKitIdentity: guest("d").LiveKitIdentity()}}
	now := time.Now()
	m := mediaState{
		Current: &youtubeTrack{ID: "t1", VideoID: "dQw4w9WgXcQ"},
		Queue:   []youtubeTrack{{ID: "t2", VideoID: "M7lc1UVf-VE"}},
		Status:  "PLAYING",
	}

	// 4 listeners: 3 votes needed.
	if err := m.voteSkip(room, guest("a"), "t1", listeners, now); err != nil {
		t.Fatal(err)
	}
	_ = m.voteSkip(room, guest("a"), "t1", listeners, now) // duplicate vote ignored
	_ = m.voteSkip(room, guest("b"), "t1", listeners, now)
	if m.Current.ID != "t1" || len(m.SkipVotes) != 2 {
		t.Fatalf("skipped too early: current=%s votes=%v", m.Current.ID, m.SkipVotes)
	}
	// A vote naming an old track must not count toward the new one.
	_ = m.voteSkip(room, guest("c"), "t0", listeners, now)
	if len(m.SkipVotes) != 2 {
		t.Fatal("stale track vote counted")
	}
	_ = m.voteSkip(room, guest("c"), "t1", listeners, now)
	if m.Current == nil || m.Current.ID != "t2" || len(m.SkipVotes) != 0 || m.SkipVotesFor != "" {
		t.Fatalf("majority did not advance cleanly: %+v", m)
	}

	// A guest from another room cannot vote.
	outsider := domain.Identity{ID: "x", Type: domain.IdentityGuest, RoomID: "other"}
	if err := m.voteSkip(room, outsider, "t2", listeners, now); err != errMediaDenied {
		t.Fatalf("expected denial, got %v", err)
	}
}

func TestSkipVotesNeeded(t *testing.T) {
	for listeners, want := range map[int]int{0: 1, 1: 1, 2: 2, 3: 2, 4: 3, 5: 3} {
		if got := skipVotesNeeded(listeners); got != want {
			t.Fatalf("listeners=%d want %d got %d", listeners, want, got)
		}
	}
}

func TestSkipVotesReconcileDepartures(t *testing.T) {
	now := time.Now()
	a := domain.Participant{LiveKitIdentity: "user:a"}
	b := domain.Participant{LiveKitIdentity: "user:b"}
	c := domain.Participant{LiveKitIdentity: "user:c"}
	m := mediaState{Current: &youtubeTrack{ID: "t1"}, Queue: []youtubeTrack{{ID: "t2"}}, SkipVotesFor: "t1", SkipVotes: []string{a.LiveKitIdentity, b.LiveKitIdentity}}
	m.reconcileSkipVotes([]domain.Participant{a, b}, now)
	if m.Current.ID != "t2" || len(m.SkipVotes) != 0 {
		t.Fatalf("majority after departure did not advance: %+v", m)
	}
	m = mediaState{Current: &youtubeTrack{ID: "t1"}, SkipVotesFor: "t1", SkipVotes: []string{a.LiveKitIdentity, b.LiveKitIdentity}}
	m.reconcileSkipVotes([]domain.Participant{b, c}, now)
	if m.Current.ID != "t1" || len(m.SkipVotes) != 1 || m.SkipVotes[0] != b.LiveKitIdentity {
		t.Fatalf("departed vote counted: %+v", m)
	}
}

func TestSkipVoteReconcilesOnLocalLeave(t *testing.T) {
	room := domain.Room{ID: "room", AllowGuests: true}
	h := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	h.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, media: mediaState{Current: &youtubeTrack{ID: "t1"}, Queue: []youtubeTrack{{ID: "t2"}}, SkipVotesFor: "t1", SkipVotes: []string{"user:a", "user:b"}}}
	for _, id := range []string{"a", "b", "c"} {
		h.rooms[room.ID].clients[id] = &client{id: id, roomID: room.ID, explicitLeave: true, participant: domain.Participant{LiveKitIdentity: "user:" + id}, send: make(chan []byte, 64)}
	}
	h.remove(h.rooms[room.ID].clients["c"])
	if h.rooms[room.ID].media.Current.ID != "t2" {
		t.Fatal("leave did not reconcile")
	}
	_ = h.Shutdown(context.Background())
}

type skipForwarder struct {
	mediaAuthorityStub
	target    *Hub
	forwarded bool
}

func (*skipForwarder) MediaOwner(context.Context, string) (bool, string, error) {
	return false, "owner", nil
}
func (b *skipForwarder) ForwardMedia(ctx context.Context, owner, room, kind string, payload json.RawMessage, actor domain.Identity) error {
	b.forwarded = true
	response := b.target.handleForwardedMedia(ctx, mediaRPCRequest{RoomID: room, Kind: kind, Payload: payload, Actor: actor})
	if response.Error != "" {
		return errors.New(response.Error)
	}
	return nil
}

func TestSkipReconciliationForwardsToOwner(t *testing.T) {
	room := domain.Room{ID: "room"}
	owner := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	follower := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	media := mediaState{Current: &youtubeTrack{ID: "t1"}, Queue: []youtubeTrack{{ID: "t2"}}, SkipVotesFor: "t1", SkipVotes: []string{"user:a", "user:b"}}
	owner.rooms[room.ID] = &roomState{room: room, media: media.snapshot(), clients: map[string]*client{}}
	for _, id := range []string{"a", "b"} {
		owner.rooms[room.ID].clients[id] = &client{id: id, roomID: room.ID, participant: domain.Participant{LiveKitIdentity: "user:" + id}, send: make(chan []byte, 64)}
	}
	follower.rooms[room.ID] = &roomState{room: room, media: media.snapshot()}
	bus := &skipForwarder{target: owner}
	follower.SetBus(bus)
	follower.reconcileRoomSkipVotes(context.Background(), room.ID)
	if !bus.forwarded || owner.rooms[room.ID].media.Current.ID != "t2" {
		t.Fatal("owner did not reconcile remote departure")
	}
	if follower.rooms[room.ID].media.Current.ID != "t1" {
		t.Fatal("follower mutated authoritative state")
	}
	_ = owner.Shutdown(context.Background())
	_ = follower.Shutdown(context.Background())
}

type unavailableSkipPresence struct{ admissionBus }

func (*unavailableSkipPresence) Publish(context.Context, string, []byte) error { return nil }
func (*unavailableSkipPresence) ListPresence(context.Context, string) ([]domain.Participant, error) {
	return nil, errors.New("redis unavailable")
}
func TestSkipPresenceFailureDoesNotReduceMajority(t *testing.T) {
	h := New(&realtimeStore{}, nil, nil, nil, nil)
	h.SetBus(&unavailableSkipPresence{})
	if _, err := h.skipParticipants(context.Background(), "room"); err == nil {
		t.Fatal("must not use incomplete local electorate")
	}
}
