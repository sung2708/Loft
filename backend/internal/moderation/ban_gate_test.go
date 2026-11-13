package moderation

import (
	"context"
	"errors"
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
func (s *stubBans) ListAdminAudit(context.Context, int, int) ([]domain.AdminAuditEntry, int, error) {
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
