// Package moderation enforces account suspensions at authentication time.
package moderation

import (
	"context"
	"sync"
	"time"

	"loft/backend/internal/domain"
)

const (
	defaultTTL = 15 * time.Second
	maxEntries = 10000
)

type entry struct {
	ban     *domain.AccountBan
	checked time.Time
}

// BanGate caches suspension lookups for a short TTL so every request does not
// hit Postgres. A lookup error fails closed unless a previous answer exists.
// No I/O happens while mu is held.
type BanGate struct {
	store   domain.AccountBanStore
	ttl     time.Duration
	now     func() time.Time
	mu      sync.Mutex
	entries map[string]entry
}

func NewBanGate(store domain.AccountBanStore) *BanGate {
	return &BanGate{store: store, ttl: defaultTTL, now: time.Now, entries: make(map[string]entry)}
}

// Check returns domain.ErrAccountSuspended for an active ban. Guests are
// never suspended at account level (they have no durable account).
func (g *BanGate) Check(ctx context.Context, identity domain.Identity) error {
	if g == nil || identity.Type != domain.IdentityUser || identity.ID == "" {
		return nil
	}
	now := g.now()
	g.mu.Lock()
	cached, ok := g.entries[identity.ID]
	g.mu.Unlock()
	if !ok || now.Sub(cached.checked) > g.ttl {
		ban, err := g.store.ActiveAccountBan(ctx, identity.ID)
		if err != nil {
			if !ok {
				return err
			}
		} else {
			cached = entry{ban: ban, checked: now}
			g.mu.Lock()
			if len(g.entries) >= maxEntries {
				g.entries = make(map[string]entry)
			}
			g.entries[identity.ID] = cached
			g.mu.Unlock()
		}
	}
	if cached.ban != nil && cached.ban.Active(now) {
		return domain.ErrAccountSuspended
	}
	return nil
}

// Invalidate drops a cached answer after a ban changes on this instance.
func (g *BanGate) Invalidate(userID string) {
	if g == nil {
		return
	}
	g.mu.Lock()
	delete(g.entries, userID)
	g.mu.Unlock()
}
