package realtime

import "math"

type boardCursor struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Drawing bool    `json:"drawing"`
	Visible bool    `json:"visible"`
}
type boardPresence struct {
	boardCursor
	ConnectionID string `json:"connection_id"`
	Name         string `json:"name"`
}
type boardChanged struct {
	Version int64 `json:"version"`
}

func (h *Hub) NotifyBoard(roomID string, version int64) {
	h.broadcast(roomID, event("board.changed", roomID, boardChanged{version}), "")
}
func validBoardCursor(c boardCursor) bool {
	return !math.IsNaN(c.X) && !math.IsNaN(c.Y) && !math.IsInf(c.X, 0) && !math.IsInf(c.Y, 0) && math.Abs(c.X) <= 1e7 && math.Abs(c.Y) <= 1e7
}
