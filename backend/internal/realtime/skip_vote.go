package realtime

import (
	"context"
	"slices"
	"time"

	"loft/backend/internal/domain"
)

// skipVotesNeeded is a strict majority of the people currently in the room.
func skipVotesNeeded(listeners int) int {
	if listeners < 1 {
		listeners = 1
	}
	return listeners/2 + 1
}

// voteSkip records one vote per identity for the current track and advances
// once a majority agrees. Votes naming another track are ignored, so a vote
// that races a track change can never skip the next song.
func (m *mediaState) voteSkip(room domain.Room, actor domain.Identity, trackID string, listeners []domain.Participant, now time.Time) error {
	if !domain.CanVoteSkip(room, actor) || !slices.ContainsFunc(listeners, func(p domain.Participant) bool { return p.LiveKitIdentity == actor.LiveKitIdentity() }) {
		return errMediaDenied
	}
	if m.Current == nil || trackID == "" || trackID != m.Current.ID {
		return nil
	}
	m.updateSkipVotes(listeners, actor.LiveKitIdentity(), now)
	return nil
}

func (m *mediaState) reconcileSkipVotes(listeners []domain.Participant, now time.Time) {
	m.updateSkipVotes(listeners, "", now)
}

func (m *mediaState) updateSkipVotes(listeners []domain.Participant, voter string, now time.Time) {
	active := make(map[string]bool, len(listeners))
	for _, p := range listeners {
		active[p.LiveKitIdentity] = true
	}
	votes := make([]string, 0, len(m.SkipVotes)+1)
	if m.Current != nil && m.SkipVotesFor == m.Current.ID {
		for _, id := range m.SkipVotes {
			if active[id] {
				votes = append(votes, id)
			}
		}
	}
	if voter != "" && !slices.Contains(votes, voter) {
		votes = append(votes, voter)
	}
	changed := !slices.Equal(votes, m.SkipVotes)
	m.SkipVotes = votes
	if m.Current != nil && len(votes) > 0 {
		m.SkipVotesFor = m.Current.ID
		if len(active) > 0 && len(votes) >= skipVotesNeeded(len(active)) {
			m.advance(now)
			changed = true
		}
	} else {
		m.SkipVotesFor = ""
	}
	if changed {
		m.Version++
	}
}

// Never shrink the electorate to this node's clients when Redis is unavailable.
func (h *Hub) skipParticipants(ctx context.Context, roomID string) ([]domain.Participant, error) {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	if presence, ok := bus.(admissionBus); ok {
		lookup, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		defer cancel()
		return presence.ListPresence(lookup, roomID)
	}
	return h.localParticipants(roomID), nil
}

func (h *Hub) reconcileRoomSkipVotes(parent context.Context, roomID string) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	h.mu.RLock()
	state := h.rooms[roomID]
	active := !h.closing && state != nil && len(state.media.SkipVotes) > 0
	h.mu.RUnlock()
	if !active {
		return
	}
	if authority, ok := h.mediaAuthorityForRoom(roomID); ok {
		owner, ownerID, err := authority.MediaOwner(ctx, roomID)
		if err != nil {
			return
		}
		if !owner {
			_ = authority.ForwardMedia(ctx, ownerID, roomID, "internal.skip.reconcile", nil, domain.Identity{})
			return
		}
	}
	h.handleForwardedMedia(ctx, mediaRPCRequest{RoomID: roomID, Kind: "internal.skip.reconcile"})
}

// localParticipants copies this instance's connected participants for a room.
func (h *Hub) localParticipants(roomID string) []domain.Participant {
	h.mu.RLock()
	defer h.mu.RUnlock()
	state := h.rooms[roomID]
	if state == nil {
		return nil
	}
	participants := make([]domain.Participant, 0, len(state.clients))
	for _, c := range state.clients {
		if !c.disconnected {
			participants = append(participants, c.participant)
		}
	}
	return participants
}
