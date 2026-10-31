package realtime

import (
	"context"
	"github.com/coder/websocket"
	"time"
)

func (h *Hub) NotifyRoomEnded(roomID string) {
	data := event("room.ended", roomID, struct{}{})
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	if bus != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := bus.Publish(ctx, roomID, data)
		cancel()
		if err != nil {
			h.logger.Warn("publish room end failed", "room_id", roomID, "error", err)
		}
	}
	h.endRoomLocal(roomID)
}
func (h *Hub) endRoomLocal(roomID string) {
	h.mu.Lock()
	state := h.rooms[roomID]
	clients := make([]*client, 0)
	if state != nil {
		state.ended = true
		state.pendingSelection = nil
		if state.mediaTimer != nil {
			state.mediaTimer.Stop()
			state.mediaTimer = nil
		}
		state.media = mediaState{Status: "IDLE", Version: state.media.Version + 1, Queue: []youtubeTrack{}}
		for _, c := range state.clients {
			c.explicitLeave = true
			c.suppressLeave = true
			clients = append(clients, c)
		}
	}
	h.mu.Unlock()
	data := event("room.ended", roomID, struct{}{})
	for _, c := range clients {
		if c.conn == nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		_ = c.conn.Write(ctx, websocket.MessageText, data)
		cancel()
		_ = c.conn.CloseNow()
	}
	h.releaseMediaOwner(roomID)
}
