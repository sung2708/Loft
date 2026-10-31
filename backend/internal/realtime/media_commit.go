package realtime

import (
	"context"
	"errors"
	"loft/backend/internal/store"
	"time"
)

type pendingMediaSelection struct {
	TransactionID string
	Media         mediaState
	Previous      mediaState
	Pick          *youtubeRoomPick
}

// Called with the room command gate held. Confirmation uses the existing room timer.
func (h *Hub) failedMediaEffects(ctx context.Context, roomID string, media, previous mediaState, pick *youtubeRoomPick, err error) error {
	var pending *store.SelectionCommitPendingError
	if errors.As(err, &pending) {
		h.mu.Lock()
		if state := h.rooms[roomID]; state != nil {
			state.pendingSelection = &pendingMediaSelection{TransactionID: pending.TransactionID, Media: media, Previous: previous, Pick: pick}
			h.scheduleMediaEnd(roomID, state)
		}
		h.mu.Unlock()
		return store.ErrSelectionCommitPending
	}
	h.undoMediaEffects(ctx, roomID, media, previous)
	return errors.New("Could not save music change; retry")
}

func (h *Hub) resolvePendingMedia(ctx context.Context, roomID string) error {
	h.mu.RLock()
	state := h.rooms[roomID]
	var pending *pendingMediaSelection
	if state != nil {
		pending = state.pendingSelection
	}
	h.mu.RUnlock()
	if pending == nil {
		return nil
	}
	// Keep the existing fenced owner while the database outcome is pending.
	if authority, ok := h.mediaAuthorityForRoom(roomID); ok {
		leaseCtx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
		_, _, _ = authority.MediaOwner(leaseCtx, roomID)
		cancel()
	}
	repo, ok := h.store.(interface {
		YouTubeSelectionStatus(context.Context, string) (store.SelectionCommitStatus, error)
	})
	status := store.SelectionInProgress
	var err error
	if ok {
		status, err = repo.YouTubeSelectionStatus(ctx, pending.TransactionID)
	} else {
		err = store.ErrSelectionCommitPending
	}
	if err != nil {
		h.logger.Warn("confirm media transaction failed", "room_id", roomID, "error", err)
	}
	resolved := err == nil && (status == store.SelectionCommitted || status == store.SelectionAborted)
	if resolved && status == store.SelectionAborted {
		if err = h.undoMediaEffects(ctx, roomID, pending.Media, pending.Previous); err != nil {
			resolved = false
		}
	}
	h.mu.Lock()
	active := !h.closing && h.rooms[roomID] == state && state.pendingSelection == pending
	if active {
		if resolved {
			state.pendingSelection = nil
		}
		h.scheduleMediaEnd(roomID, state)
	}
	h.mu.Unlock()
	if !active || !resolved {
		return store.ErrSelectionCommitPending
	}
	if status == store.SelectionCommitted {
		h.announceCommittedPick(roomID, pending.Pick)
		h.mu.RLock()
		media := state.media.snapshot()
		h.mu.RUnlock()
		h.broadcastLocal(roomID, event("media.state", roomID, media), "")
	}
	return nil
}
