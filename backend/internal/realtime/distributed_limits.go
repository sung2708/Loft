package realtime

import "loft/backend/internal/ratelimit"

// ConfigureDistributedRateLimits shares connection and media command budgets
// across instances. The limiters retain their bounded local fallback.
func (h *Hub) ConfigureDistributedRateLimits(remote ratelimit.Distributed) {
	h.connectionLimit.SetDistributed("ws_connect", remote)
	h.mediaLimit.SetDistributed("media_command", remote)
	h.queueLimit.SetDistributed("queue_command", remote)
	h.chatLimit.SetDistributed("chat_message", remote)
	h.reactionLimit.SetDistributed("reaction", remote)
}
