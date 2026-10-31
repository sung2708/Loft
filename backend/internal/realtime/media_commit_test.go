package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"loft/backend/internal/domain"
	"loft/backend/internal/store"
	"sync"
	"testing"
	"time"
)

type uncertainSelectionStore struct {
	*youtubeRealtimeMockStore
	statusMu      sync.Mutex
	status        store.SelectionCommitStatus
	statusErr     error
	commitApplied bool
}

func (s *uncertainSelectionStore) CommitYouTubeSelection(ctx context.Context, roomID string, settings *store.YouTubeMediaSettings, pickID string) error {
	if s.commitApplied {
		if err := s.youtubeRealtimeMockStore.CommitYouTubeSelection(ctx, roomID, settings, pickID); err != nil {
			return err
		}
	}
	return &store.SelectionCommitPendingError{TransactionID: "123", Cause: errors.New("COMMIT acknowledgement lost")}
}
func (s *uncertainSelectionStore) YouTubeSelectionStatus(context.Context, string) (store.SelectionCommitStatus, error) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	return s.status, s.statusErr
}
func TestUncertainSelectionWaitsForDurableCommitOutcome(t *testing.T) {
	for _, outcome := range []store.SelectionCommitStatus{store.SelectionCommitted, store.SelectionAborted} {
		t.Run(string(outcome), func(t *testing.T) {
			room := domain.Room{ID: "uncertain", OwnerID: "owner"}
			repo := &uncertainSelectionStore{youtubeRealtimeMockStore: newYouTubeRealtimeMockStore(room), commitApplied: outcome == store.SelectionCommitted, status: store.SelectionInProgress}
			repo.picks["pick"] = store.YouTubeRoomPick{ID: "pick", RoomID: room.ID, Active: true}
			hub := New(repo, nil, nil, nil, nil)
			state := &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "PAUSED", Current: &youtubeTrack{ID: "old", VideoID: "aaaaaaaaaaa"}}, picks: []youtubeRoomPick{{ID: "pick", VideoID: "dQw4w9WgXcQ"}}}
			hub.rooms[room.ID] = state
			defer hub.Shutdown(context.Background())
			response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "youtube.pick.promote", Payload: json.RawMessage(`{"pick_id":"pick"}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
			if response.Error != store.ErrSelectionCommitPending.Error() || state.media.Current.VideoID != "dQw4w9WgXcQ" || state.pendingSelection == nil || len(state.picks) != 1 {
				t.Fatalf("uncertain commit was undone: %+v", response)
			}
			if err := resolveSelectionForTest(t, hub, room.ID); !errors.Is(err, store.ErrSelectionCommitPending) {
				t.Fatal("unconfirmed transaction treated as complete")
			}
			// Reject further changes while the outcome remains unknown.
			result := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "queue.add", Payload: json.RawMessage(`{"url":"https://youtu.be/M7lc1UVf-VE"}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
			if result.Error == "" || state.media.Version != 1 {
				t.Fatal("command overtook pending persistence")
			}
			repo.statusMu.Lock()
			repo.status = outcome
			repo.statusMu.Unlock()
			if err := resolveSelectionForTest(t, hub, room.ID); err != nil {
				t.Fatal(err)
			}
			if state.pendingSelection != nil {
				t.Fatal("confirmation not cleared")
			}
			if outcome == store.SelectionCommitted {
				if len(state.picks) != 0 || state.media.Current.VideoID != "dQw4w9WgXcQ" || repo.picks["pick"].Active {
					t.Fatal("committed selection lost after acknowledgement loss")
				}
			} else if len(state.picks) != 1 || state.media.Current.ID != "old" || !repo.picks["pick"].Active {
				t.Fatal("aborted selection not restored")
			}
		})
	}
}
func TestPendingSelectionTimerConfirmsWithoutClientReload(t *testing.T) {
	room := domain.Room{ID: "timer-confirm", OwnerID: "owner"}
	repo := &uncertainSelectionStore{youtubeRealtimeMockStore: newYouTubeRealtimeMockStore(room), commitApplied: true, status: store.SelectionCommitted}
	repo.picks["pick"] = store.YouTubeRoomPick{ID: "pick", RoomID: room.ID, Active: true}
	hub := New(repo, nil, nil, nil, nil)
	defer hub.Shutdown(context.Background())
	listener := &client{id: "listener", roomID: room.ID, send: make(chan []byte, 16)}
	hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{listener.id: listener}, media: mediaState{Status: "IDLE"}, picks: []youtubeRoomPick{{ID: "pick", VideoID: "dQw4w9WgXcQ"}}}
	_ = hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "youtube.pick.promote", Payload: json.RawMessage(`{"pick_id":"pick"}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
	timeout := time.NewTimer(4 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case raw := <-listener.send:
			var envelope Envelope
			_ = json.Unmarshal(raw, &envelope)
			if envelope.Type == "youtube.pick.promoted" {
				return
			}
		case <-timeout.C:
			t.Fatal("timer did not confirm selection")
		}
	}
}

func resolveSelectionForTest(t *testing.T, hub *Hub, roomID string) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	release, err := hub.acquireMediaCommand(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	return hub.resolvePendingMedia(ctx, roomID)
}

func TestAbortedSelectionRetriesCompensationWhenCoordinatorIsUnavailable(t *testing.T) {
	room := domain.Room{ID: "retry-abort", OwnerID: "owner"}
	repo := &uncertainSelectionStore{youtubeRealtimeMockStore: newYouTubeRealtimeMockStore(room), status: store.SelectionAborted}
	repo.picks["pick"] = store.YouTubeRoomPick{ID: "pick", RoomID: room.ID, Active: true}
	hub := New(repo, nil, nil, nil, nil)
	defer hub.Shutdown(context.Background())
	authority := &mediaAuthorityStub{}
	hub.SetBus(authority)
	state := &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "PAUSED", Current: &youtubeTrack{ID: "old", VideoID: "aaaaaaaaaaa"}}, picks: []youtubeRoomPick{{ID: "pick", VideoID: "dQw4w9WgXcQ"}}}
	hub.rooms[room.ID] = state
	_ = hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "youtube.pick.promote", Payload: json.RawMessage(`{"pick_id":"pick"}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
	authority.commitErr = errors.New("coordinator unavailable")
	if err := resolveSelectionForTest(t, hub, room.ID); !errors.Is(err, store.ErrSelectionCommitPending) {
		t.Fatal("failed compensation was marked complete")
	}
	if state.pendingSelection == nil {
		t.Fatal("confirmation retry was lost")
	}
	authority.commitErr = nil
	if err := resolveSelectionForTest(t, hub, room.ID); err != nil {
		t.Fatal(err)
	}
	if state.pendingSelection != nil || state.media.Current.ID != "old" || !repo.picks["pick"].Active {
		t.Fatal("compensation did not recover")
	}
}
