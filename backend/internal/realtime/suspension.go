package realtime

import (
	"context"
	"errors"
	"time"

	"github.com/coder/websocket"

	"loft/backend/internal/domain"
)

// This reserved bus scope reaches every node, even if the admin's node has no rooms.
const accountModerationScope = "account-moderation"

type accountChanged struct {
	UserID string `json:"user_id"`
	Profile bool `json:"profile,omitempty"`
}

func (h *Hub) DisconnectUser(ctx context.Context, userID string) {
	h.publishRemote(accountModerationScope, event("account.changed", accountModerationScope, accountChanged{UserID: userID}))
	_ = h.checkAccountAccess(ctx, domain.Identity{ID: userID, Type: domain.IdentityUser})
}

// PostgreSQL is rechecked so a delayed notification cannot reapply a lifted ban.
func (h *Hub) checkAccountAccess(ctx context.Context, identity domain.Identity) error {
	if identity.Type != domain.IdentityUser {
		return nil
	}
	err := h.users.CheckAccount(ctx, identity.ID)
	if errors.Is(err, domain.ErrUnauthorized) {
		h.disconnectUserLocal(ctx, identity.ID, errorPayload{"UNAUTHORIZED", "Sign in to continue"})
		return err
	}
	if err != nil {
		return err
	}
	err = h.bans.Refresh(ctx, identity)
	if errors.Is(err, domain.ErrAccountSuspended) {
		h.disconnectUserLocal(ctx, identity.ID, errorPayload{"ACCOUNT_SUSPENDED", "This account is suspended"})
	}
	return err
}

// Socket and LiveKit I/O happen after the hub lock is released.
func (h *Hub) disconnectUserLocal(ctx context.Context, userID string, reason errorPayload) {
	h.bans.Invalidate(userID)
	h.mu.RLock()
	var targets []*client
	for _, state := range h.rooms {
		for _, c := range state.clients {
			if c.identity.Type == domain.IdentityUser && c.identity.ID == userID {
				targets = append(targets, c)
			}
		}
	}
	evictor := h.evictor
	h.mu.RUnlock()

	for _, c := range targets {
		writeCtx, cancel := context.WithTimeout(ctx, time.Second)
		_ = c.conn.Write(writeCtx, websocket.MessageText, event("error", c.roomID, reason))
		cancel()
		_ = c.conn.CloseNow()
		if evictor != nil {
			ejectCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			if err := evictor.RemoveParticipant(ejectCtx, c.roomID, c.identity.LiveKitIdentity()); err != nil {
				h.logger.Warn("LiveKit removal after account disconnect failed", "room_id", c.roomID, "error", err)
			}
			cancel()
		}
	}
}

// InvalidateSuspension refreshes the cached ban state after a ban is lifted.
func (h *Hub) InvalidateSuspension(userID string) {
	h.bans.Invalidate(userID)
	h.publishRemote(accountModerationScope, event("account.changed", accountModerationScope, accountChanged{UserID: userID}))
}
