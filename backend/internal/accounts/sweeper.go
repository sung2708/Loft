// Package accounts purges accounts whose deletion grace period has ended.
package accounts

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"loft/backend/internal/domain"
)

// RoomGuard is the realtime hub's deletion fence: it refuses rooms that have
// people in them and blocks new joins while a room is being deleted.
type RoomGuard interface {
	BeginDelete(roomID string) bool
	FinishDelete(roomID string, deleted bool)
}

// Disconnector ends a deleted member's live connections.
type Disconnector interface {
	DisconnectUser(context.Context, string)
}

const (
	defaultInterval = 10 * time.Minute
	batchSize       = 20
	busyRetry       = time.Hour
	purgeTimeout    = 30 * time.Second
)

type Sweeper struct {
	store    domain.AccountStore
	guard    RoomGuard
	notify   Disconnector
	logger   *slog.Logger
	interval time.Duration
	now      func() time.Time
}

func NewSweeper(store domain.AccountStore, guard RoomGuard, notify Disconnector, logger *slog.Logger) *Sweeper {
	if logger == nil {
		logger = slog.Default()
	}
	return &Sweeper{store: store, guard: guard, notify: notify, logger: logger, interval: defaultInterval, now: time.Now}
}

// Run sweeps until ctx is cancelled. Its owner is the process lifetime; it
// handles one bounded batch per tick and never runs two sweeps at once.
// With several instances each one sweeps; PurgeAccount locks the schedule
// row, so an account is purged once.
func (s *Sweeper) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		s.Sweep(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Sweep purges up to one batch of due accounts and reports how many went.
func (s *Sweeper) Sweep(ctx context.Context) int {
	now := s.now().UTC()
	due, err := s.store.DueAccountDeletions(ctx, now, batchSize)
	if err != nil {
		if ctx.Err() == nil {
			s.logger.Error("list due account deletions", "error", err)
		}
		return 0
	}
	purged := 0
	for _, deletion := range due {
		if ctx.Err() != nil {
			break
		}
		if s.purge(ctx, deletion, now) {
			purged++
		}
	}
	return purged
}

func (s *Sweeper) purge(parent context.Context, deletion domain.DueDeletion, now time.Time) bool {
	userID := deletion.UserID
	ctx, cancel := context.WithTimeout(parent, purgeTimeout)
	defer cancel()
	rooms, err := s.store.OwnedRoomIDs(ctx, userID)
	if err != nil {
		s.logger.Error("list rooms for account deletion", "error", err)
		s.postpone(parent, deletion, now.Add(busyRetry), "room lookup failed")
		return false
	}
	fenced := make([]string, 0, len(rooms))
	release := func(deleted bool) {
		for _, roomID := range fenced {
			s.guard.FinishDelete(roomID, deleted)
		}
	}
	if s.guard != nil {
		for _, roomID := range rooms {
			if !s.guard.BeginDelete(roomID) {
				release(false)
				s.postpone(parent, deletion, now.Add(busyRetry), "room in use")
				return false
			}
			fenced = append(fenced, roomID)
		}
	}
	err = s.store.PurgeAccount(ctx, deletion, now, fenced)
	release(err == nil)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return false
	case errors.Is(err, domain.ErrConflict):
		s.postpone(parent, deletion, now.Add(defaultInterval), "owned rooms changed")
		return false
	case errors.Is(err, domain.ErrAccountSuspended):
		s.postpone(parent, deletion, now.Add(24*time.Hour), "account suspended")
		return false
	case err != nil:
		s.logger.Error("purge account", "error", err)
		s.postpone(parent, deletion, now.Add(busyRetry), "purge failed")
		return false
	}
	if s.notify != nil {
		s.notify.DisconnectUser(ctx, userID)
	}
	s.logger.Info("account deleted", "rooms", len(rooms))
	return true
}

func (s *Sweeper) postpone(ctx context.Context, deletion domain.DueDeletion, until time.Time, why string) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := s.store.PostponeAccountDeletion(ctx, deletion, until); err != nil {
		s.logger.Error("postpone account deletion", "error", err)
		return
	}
	s.logger.Info("account deletion postponed", "reason", why, "until", until)
}
