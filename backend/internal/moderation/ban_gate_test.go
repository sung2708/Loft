package moderation

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"loft/backend/internal/domain"
)

type stubBans struct {
	ban   *domain.AccountBan
	err   error
	calls int
}

func (s *stubBans) ActiveAccountBan(context.Context, string) (*domain.AccountBan, error) {
	s.calls++
	return s.ban, s.err
}
func (s *stubBans) BanAccount(context.Context, domain.AccountBan) error  { return nil }
func (s *stubBans) LiftAccountBan(context.Context, string, string) error { return nil }
func (s *stubBans) ListAdminAudit(context.Context, domain.AdminAuditFilter, int, int) ([]domain.AdminAuditEntry, int, error) {
	return nil, 0, nil
}

func TestBanGateCachesAndFailsClosed(t *testing.T) {
	store := &stubBans{}
	gate := NewBanGate(store)
	now := time.Unix(1000, 0)
	gate.now = func() time.Time { return now }
	user := domain.Identity{ID: "u1", Type: domain.IdentityUser}

	if err := gate.Check(context.Background(), user); err != nil {
		t.Fatal(err)
	}
	_ = gate.Check(context.Background(), user)
	if store.calls != 1 {
		t.Fatalf("expected cached lookup, got %d calls", store.calls)
	}

	expires := now.Add(time.Hour)
	store.ban = &domain.AccountBan{UserID: "u1", ExpiresAt: &expires}
	gate.Invalidate("u1")
	if err := gate.Check(context.Background(), user); !errors.Is(err, domain.ErrAccountSuspended) {
		t.Fatalf("expected suspension, got %v", err)
	}
	// Expired bans stop applying even from cache.
	now = now.Add(2 * time.Hour)
	store.ban = nil
	if err := gate.Check(context.Background(), user); err != nil {
		t.Fatalf("expired ban still enforced: %v", err)
	}

	// Unknown user + store failure fails closed; guests are never checked.
	store.err = errors.New("db down")
	if err := gate.Check(context.Background(), domain.Identity{ID: "u2", Type: domain.IdentityUser}); err == nil {
		t.Fatal("lookup failure must fail closed")
	}
	if err := gate.Check(context.Background(), domain.Identity{ID: "g", Type: domain.IdentityGuest}); err != nil {
		t.Fatal("guests must not be checked")
	}
}

func TestBanGateRefreshKeepsLastAnswerOnLookupFailure(t *testing.T) {
	ctx := context.Background()
	store := &stubBans{}
	gate := NewBanGate(store)
	user := domain.Identity{ID: "u1", Type: domain.IdentityUser}
	if err := gate.Refresh(ctx, user); err != nil {
		t.Fatal(err)
	}
	store.err = errors.New("db down")
	if err := gate.Refresh(ctx, user); err != nil {
		t.Fatalf("refresh discarded the cached answer: %v", err)
	}
	store.err = nil
	store.ban = &domain.AccountBan{UserID: user.ID}
	if err := gate.Refresh(ctx, user); !errors.Is(err, domain.ErrAccountSuspended) {
		t.Fatalf("refresh did not detect new suspension: %v", err)
	}
}

type orderedBans struct {
	stubBans
	started chan struct{}
	release chan struct{}
}

func (s *orderedBans) ActiveAccountBan(_ context.Context, id string) (*domain.AccountBan, error) {
	select {
	case <-s.started:
		return &domain.AccountBan{UserID: id}, nil
	default:
		close(s.started)
		<-s.release
		return nil, nil
	}
}

func TestBanGateDiscardsOutdatedLookup(t *testing.T) {
	for _, invalidate := range []bool{false, true} {
		name := "newer result"
		if invalidate {
			name = "invalidation"
		}
		t.Run(name, func(t *testing.T) {
			store := &orderedBans{started: make(chan struct{}), release: make(chan struct{})}
			gate := NewBanGate(store)
			user := domain.Identity{ID: "u1", Type: domain.IdentityUser}
			result := make(chan error, 1)
			go func() { result <- gate.Check(context.Background(), user) }()
			<-store.started
			if invalidate {
				gate.Invalidate(user.ID)
			} else if err := gate.Refresh(context.Background(), user); !errors.Is(err, domain.ErrAccountSuspended) {
				close(store.release)
				t.Fatalf("refresh: %v", err)
			}
			close(store.release)
			if err := <-result; err == nil || (!invalidate && !errors.Is(err, domain.ErrAccountSuspended)) {
				t.Fatalf("outdated lookup returned %v", err)
			}
			if err := gate.Check(context.Background(), user); !errors.Is(err, domain.ErrAccountSuspended) {
				t.Fatalf("outdated lookup populated cache: %v", err)
			}
		})
	}
}

func TestBanGateInvalidationDoesNotAffectOtherAccount(t *testing.T) {
	store := &orderedBans{started: make(chan struct{}), release: make(chan struct{})}
	gate := NewBanGate(store)
	user := domain.Identity{ID: "u2", Type: domain.IdentityUser}
	result := make(chan error, 1)
	go func() { result <- gate.Check(context.Background(), user) }()
	<-store.started
	gate.Invalidate("u1")
	close(store.release)
	if err := <-result; err != nil {
		t.Fatalf("unrelated invalidation interrupted lookup: %v", err)
	}
	if err := gate.Check(context.Background(), user); err != nil {
		t.Fatalf("successful lookup was not cached: %v", err)
	}
}

func TestBanGateFullCacheDoesNotInterruptLookup(t *testing.T) {
	store := &orderedBans{started: make(chan struct{}), release: make(chan struct{})}
	gate := NewBanGate(store)
	for i := range maxEntries {
		gate.entries[fmt.Sprint(i)] = entry{}
	}
	user := domain.Identity{ID: "waiting", Type: domain.IdentityUser}
	result := make(chan error, 1)
	go func() { result <- gate.Check(context.Background(), user) }()
	<-store.started
	err := gate.Check(context.Background(), domain.Identity{ID: "new", Type: domain.IdentityUser})
	close(store.release)
	if err != domain.ErrAccountSuspended {
		t.Fatalf("unexpected new account result: %v", err)
	}
	if err := <-result; err != nil {
		t.Fatalf("cache eviction interrupted lookup: %v", err)
	}
	if len(gate.entries) > maxEntries {
		t.Fatal("cache exceeded its limit")
	}
}
