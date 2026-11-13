package realtime

import (
	"context"
	"time"

	"loft/backend/internal/domain"
)

type participantAvatar struct {
	ConnectionID string `json:"connection_id"`
	AvatarURL    string `json:"avatar_url"`
}

func (h *Hub) NotifyProfileChanged(ctx context.Context, userID string) {
	h.refreshProfileAvatar(ctx, userID)
	h.publishRemote(accountModerationScope, event("account.changed", accountModerationScope, accountChanged{UserID: userID, Profile: true}))
}

func (h *Hub) visibleAvatar(ctx context.Context, userID, avatar string) string {
	profiles, ok := h.store.(interface {
		AccountProfile(context.Context, string) (domain.AccountProfile, error)
	})
	if !ok {
		return avatar
	}
	ctx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
	defer cancel()
	profile, err := profiles.AccountProfile(ctx, userID)
	if err != nil || profile.HideAvatar {
		return ""
	}
	return profile.AvatarURL
}

func (h *Hub) refreshProfileAvatar(ctx context.Context, userID string) {
	h.mu.RLock()
	var targets []*client
	for _, room := range h.rooms {
		for _, c := range room.clients {
			if c.identity.Type == domain.IdentityUser && c.identity.ID == userID && !c.disconnected {
				targets = append(targets, c)
			}
		}
	}
	h.mu.RUnlock()
	if len(targets) == 0 {
		return
	}
	avatar := h.visibleAvatar(ctx, userID, targets[0].identity.AvatarURL)
	for _, c := range targets {
		h.mu.Lock()
		state := h.rooms[c.roomID]
		changed := state != nil && state.clients[c.id] == c && !c.disconnected && c.participant.AvatarURL != avatar
		if changed {
			c.participant.AvatarURL = avatar
		}
		h.mu.Unlock()
		if changed {
			h.refreshPresence(ctx, c)
			h.broadcast(c.roomID, event("participant.avatar", c.roomID, participantAvatar{c.id, avatar}), "")
		}
	}
}
