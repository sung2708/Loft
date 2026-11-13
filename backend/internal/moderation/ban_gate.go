// Package moderation enforces account suspensions at authentication time.
package moderation

import (
	"context"
	"errors"
	"sync"
	"time"

	"loft/backend/internal/domain"
)

const (
	defaultTTL = 15 * time.Second
	maxEntries = 10000
)

type entry struct {
	ban      *domain.AccountBan
	checked  time.Time
	sequence uint64
}

// BanGate caches suspension lookups for a short TTL so every request does not
// hit Postgres. A lookup error fails closed unless a previous answer exists.
// No I/O happens while mu is held.
type BanGate struct {
	store    domain.AccountBanStore
	ttl      time.Duration
	now      func() time.Time
	mu       sync.Mutex
	entries  map[string]entry
	sequence uint64
	pending  map[string]*int
}

func NewBanGate(store domain.AccountBanStore) *BanGate {
	return &BanGate{store: store, ttl: defaultTTL, now: time.Now, entries: make(map[string]entry), pending: make(map[string]*int)}
}

// Check returns domain.ErrAccountSuspended for an active ban. Guests are
// never suspended at account level (they have no durable account).
func (g *BanGate) Check(ctx context.Context, identity domain.Identity) error {
	return g.check(ctx, identity, false)
}

func (g *BanGate) Refresh(ctx context.Context, identity domain.Identity) error {
	return g.check(ctx, identity, true)
}

func (g *BanGate) check(ctx context.Context, identity domain.Identity, refresh bool) error {
	if g == nil || identity.Type != domain.IdentityUser || identity.ID == "" {
		return nil
	}
	now := g.now()
	g.mu.Lock()
	cached, ok := g.entries[identity.ID]
	if refresh || !ok || now.Sub(cached.checked) > g.ttl {
		pending := g.pending[identity.ID]
		if pending == nil {
			pending = new(int)
			g.pending[identity.ID] = pending
		}
		(*pending)++
		g.sequence++
		sequence := g.sequence
		g.mu.Unlock()
		ban, err := g.store.ActiveAccountBan(ctx, identity.ID)
		g.mu.Lock()
		invalidated := g.pending[identity.ID] != pending
		(*pending)--
		if !invalidated && *pending == 0 {
			delete(g.pending, identity.ID)
		}
		current, exists := g.entries[identity.ID]
		switch {
		case exists && current.sequence > sequence:
			cached = current
		case invalidated:
			g.mu.Unlock()
			return errors.New("account suspension changed during lookup")
		case err == nil:
			cached = entry{ban: ban, checked: now, sequence: sequence}
			if !exists && len(g.entries) >= maxEntries {
				for id := range g.entries {
					if g.pending[id] == nil {
						delete(g.entries, id)
						break
					}
				}
			}
			if exists || len(g.entries) < maxEntries {
				g.entries[identity.ID] = cached
			}
		case !ok:
			g.mu.Unlock()
			return err
		}
	}
	g.mu.Unlock()
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
	delete(g.pending, userID)
	delete(g.entries, userID)
	g.mu.Unlock()
}
