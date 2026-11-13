package realtime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"loft/backend/internal/domain"
)

// reviseChat applies chat.edit / chat.delete. It returns false only when the
// room has ended and the connection loop must stop. No hub lock is held here:
// every call below performs database I/O.
func (h *Hub) reviseChat(ctx context.Context, c *client, envelope Envelope) bool {
	messages, ok := h.store.(domain.MessageStore)
	if !ok {
		h.sendError(c, "UNSUPPORTED", "Message changes are unavailable")
		return true
	}
	var target chatEditPayload
	if err := json.Unmarshal(envelope.Payload, &target); err != nil {
		h.sendError(c, "INVALID_PAYLOAD", "Invalid chat payload")
		return true
	}
	if _, err := uuid.Parse(target.MessageID); err != nil {
		h.sendError(c, "INVALID_PAYLOAD", "Invalid message")
		return true
	}
	current, err := messages.GetMessage(ctx, c.roomID, target.MessageID)
	if errors.Is(err, domain.ErrNotFound) {
		h.sendError(c, "MESSAGE_NOT_FOUND", "Message not found")
		return true
	}
	if err != nil {
		h.logger.Error("load chat message", "room_id", c.roomID, "connection_id", c.id, "error", err)
		h.sendError(c, "MESSAGE_UPDATE_FAILED", "Message could not be changed")
		return true
	}

	var updated domain.Message
	if envelope.Type == "chat.edit" {
		if !domain.CanEditMessage(current, c.identity) {
			h.sendError(c, "FORBIDDEN", "You cannot edit this message")
			return true
		}
		content, validationErr := domain.ValidateMessage(target.Content)
		if validationErr != nil {
			h.sendError(c, "INVALID_MESSAGE", "Message must be 1–2000 characters")
			return true
		}
		if content == current.Content {
			return true
		}
		updated, err = messages.EditMessage(ctx, c.roomID, target.MessageID, c.identity, content)
	} else {
		room, roomErr := h.store.GetRoom(ctx, c.roomID)
		if errors.Is(roomErr, domain.ErrRoomEnded) {
			h.endRoomLocal(c.roomID)
			return false
		}
		if roomErr != nil || !domain.CanDeleteMessage(room, current, c.identity) {
			h.sendError(c, "FORBIDDEN", "You cannot delete this message")
			return true
		}
		updated, err = messages.DeleteMessage(ctx, c.roomID, target.MessageID, c.identity)
	}
	if errors.Is(err, domain.ErrRoomEnded) {
		h.endRoomLocal(c.roomID)
		return false
	}
	if errors.Is(err, domain.ErrNotFound) {
		h.sendError(c, "MESSAGE_NOT_FOUND", "Message not found")
		return true
	}
	if err != nil {
		h.logger.Error("revise chat", "room_id", c.roomID, "connection_id", c.id, "action", envelope.Type, "error", err)
		h.sendError(c, "MESSAGE_UPDATE_FAILED", "Message could not be changed")
		return true
	}
	h.broadcast(c.roomID, event("chat.updated", c.roomID, updated), "")
	return true
}
