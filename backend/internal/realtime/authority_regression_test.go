package realtime

import (
	"context"
	"loft/backend/internal/domain"
	"sync"
	"testing"
)

type auditPresenceBus struct{ admissionBus }

func (*auditPresenceBus) Publish(context.Context, string, []byte) error { return nil }
func (*auditPresenceBus) AdmitPresence(_ context.Context, _, _, _, _ string, p domain.Participant, _ int, _ bool) (domain.Participant, error) {
	return p, nil
}
func TestPresenceRefreshDuringHostTransfer(t *testing.T) {
	room := domain.Room{ID: "audit-room", OwnerID: "owner", MaxParticipants: 12}
	h := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	c := &client{id: "owner-conn", roomID: room.ID, identity: domain.Identity{ID: "owner", Type: domain.IdentityUser}, send: make(chan []byte, 64)}
	h.add(c, room)
	h.SetBus(&auditPresenceBus{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			h.refreshPresence(context.Background(), c)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			h.mu.Lock()
			applyHostRolesLocked(h.rooms[room.ID])
			h.mu.Unlock()
		}
	}()
	wg.Wait()
}
func TestStaleHostIsNotBroadcast(t *testing.T) {
	room := domain.Room{ID: "audit-room", MaxParticipants: 12}
	h := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	c := &client{id: "subscriber", send: make(chan []byte, 64)}
	h.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{"subscriber": c}, host: domain.HostAuthority{ConnectionID: "z", Version: 1, State: "connected"}}
	h.DeliverRemote(room.ID, hostEvent(room.ID, domain.HostAuthority{ConnectionID: "a", Version: 1, State: "connected"}, "initial"))
	select {
	case <-c.send:
		t.Fatal("stale host was broadcast")
	default:
	}

}
func TestRemoteVoteCountNeverRegresses(t *testing.T) {
	room := domain.Room{ID: "audit-room"}
	h := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	h.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, picks: []youtubeRoomPick{{ID: "pick", Votes: 2}}}
	h.DeliverRemote(room.ID, event("youtube.pick.voted", room.ID, youtubeRoomPick{ID: "pick", Votes: 1}))
	if got := h.rooms[room.ID].picks[0].Votes; got != 2 {
		t.Fatalf("votes regressed from 2 to %d", got)
	}
}

func TestHTTPAutoplayInitializesIdleRoomThroughMediaAuthority(t *testing.T) {
	room := domain.Room{ID: "idle", OwnerID: "owner"}
	repo := newYouTubeRealtimeMockStore(room)
	hub := New(repo, nil, nil, nil, nil)
	defer hub.Shutdown(context.Background())
	owner := domain.Identity{ID: room.OwnerID, Type: domain.IdentityUser}
	if err := hub.SetRoomAutoplay(context.Background(), room, owner, true); err != nil {
		t.Fatal(err)
	}
	if !repo.settings.AutoplayEnabled || !hub.rooms[room.ID].media.Autoplay {
		t.Fatal("persisted setting and room snapshot must both enable autoplay")
	}
	if err := hub.SetRoomAutoplay(context.Background(), room, owner, false); err != nil {
		t.Fatal(err)
	}
	if repo.settings.AutoplayEnabled || hub.rooms[room.ID].media.Autoplay {
		t.Fatal("active room retained stale autoplay setting")
	}
}

func TestCommittedUnlockReachesSecondHub(t *testing.T) {
	room := domain.Room{ID: "locked", Version: 1, IsLocked: true}
	a := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	b := New(&realtimeStore{room: room}, nil, nil, nil, nil)
	a.rooms[room.ID] = &roomState{room: room}
	b.rooms[room.ID] = &roomState{room: room}
	bbus := &memoryBus{instanceID: "b", deliver: b.DeliverRemote}
	a.SetBus(&memoryBus{instanceID: "a", peers: []*memoryBus{bbus}})
	updated := room
	updated.Version++
	updated.IsLocked = false
	a.NotifyRoomAccess(updated)
	for _, hub := range []*Hub{a, b} {
		if got := hub.roomSnapshot(room.ID, room); got.IsLocked || got.Version != updated.Version {
			t.Fatalf("unlock missing in snapshot: %+v", got)
		}
	}
}
