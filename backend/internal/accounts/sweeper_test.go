package accounts

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"loft/backend/internal/domain"
)

type fakeAccounts struct {
	domain.AccountStore
	mu        sync.Mutex
	due       []string
	rooms     map[string][]string
	purged    []string
	postponed map[string]time.Time
	purgeErr  map[string]error
}

func (f *fakeAccounts) DueAccountDeletions(context.Context, time.Time, int) ([]domain.DueDeletion, error) {
	var due []domain.DueDeletion
	for _, id := range f.due {
		due = append(due, domain.DueDeletion{UserID: id})
	}
	return due, nil
}
func (f *fakeAccounts) OwnedRoomIDs(_ context.Context, id string) ([]string, error) {
	return f.rooms[id], nil
}
func (f *fakeAccounts) PurgeAccount(_ context.Context, deletion domain.DueDeletion, _ time.Time, _ []string) error {
	id := deletion.UserID
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.purgeErr[id]; err != nil {
		return err
	}
	f.purged = append(f.purged, id)
	return nil
}
func (f *fakeAccounts) PostponeAccountDeletion(_ context.Context, deletion domain.DueDeletion, until time.Time) error {
	f.mu.Lock()
	f.postponed[deletion.UserID] = until
	f.mu.Unlock()
	return nil
}

type fakeGuard struct {
	busy     map[string]bool
	begun    map[string]bool
	finished map[string]bool
}

func (g *fakeGuard) BeginDelete(id string) bool {
	if g.busy[id] {
		return false
	}
	g.begun[id] = true
	return true
}
func (g *fakeGuard) FinishDelete(id string, deleted bool) {
	delete(g.begun, id)
	g.finished[id] = deleted
}

type fakeDisconnector struct{ users []string }

func (d *fakeDisconnector) DisconnectUser(_ context.Context, id string) {
	d.users = append(d.users, id)
}

func TestSweepPurgesIdleAccountsAndPostponesBusyOnes(t *testing.T) {
	store := &fakeAccounts{
		due:       []string{"idle", "busy", "suspended", "cancelled", "failed"},
		rooms:     map[string][]string{"idle": {"r1", "r2"}, "busy": {"r3", "r4"}},
		postponed: map[string]time.Time{},
		purgeErr:  map[string]error{"suspended": domain.ErrAccountSuspended, "cancelled": domain.ErrNotFound, "failed": errors.New("delete failed")},
	}
	guard := &fakeGuard{busy: map[string]bool{"r4": true}, begun: map[string]bool{}, finished: map[string]bool{}}
	disconnect := &fakeDisconnector{}
	now := time.Date(2026, 11, 13, 8, 0, 0, 0, time.UTC)
	sweeper := NewSweeper(store, guard, disconnect, slog.New(slog.NewTextHandler(io.Discard, nil)))
	sweeper.now = func() time.Time { return now }

	if purged := sweeper.Sweep(context.Background()); purged != 1 {
		t.Fatalf("purged %d accounts", purged)
	}
	if len(store.purged) != 1 || store.purged[0] != "idle" || len(disconnect.users) != 1 {
		t.Fatalf("purged=%v disconnected=%v", store.purged, disconnect.users)
	}
	if !guard.finished["r1"] || !guard.finished["r2"] {
		t.Fatalf("idle rooms not released as deleted: %v", guard.finished)
	}
	if deleted, ok := guard.finished["r3"]; !ok || deleted {
		t.Fatalf("busy account's fenced room must be released undeleted: %v", guard.finished)
	}
	if len(guard.begun) != 0 {
		t.Fatalf("fences left open: %v", guard.begun)
	}
	if got := store.postponed["busy"]; !got.Equal(now.Add(busyRetry)) {
		t.Fatalf("busy postponed to %v", got)
	}
	if _, ok := store.postponed["suspended"]; !ok {
		t.Fatal("suspended account not postponed")
	}
	if !store.postponed["failed"].Equal(now.Add(busyRetry)) {
		t.Fatal("failed deletion must release its place in the due queue")
	}
	if _, ok := store.postponed["cancelled"]; ok {
		t.Fatal("cancelled deletion must not be rescheduled")
	}
}

func TestRunStopsWithContext(t *testing.T) {
	store := &fakeAccounts{postponed: map[string]time.Time{}}
	sweeper := NewSweeper(store, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { sweeper.Run(ctx); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop")
	}
}
