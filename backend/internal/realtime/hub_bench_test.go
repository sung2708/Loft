package realtime

import (
	"fmt"
	"io"
	"log/slog"
	"testing"

	"loft/backend/internal/domain"
)

// BenchmarkBroadcastFanout measures only the local, non-blocking enqueue path.
// The drain runs outside the timed section so queue occupancy stays bounded.
func BenchmarkBroadcastFanout(b *testing.B) {
	for _, count := range []int{10, 25, 50, 100} {
		b.Run(fmt.Sprintf("clients_%d", count), func(b *testing.B) {
			room := domain.Room{ID: "bench-room"}
			hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
			clients := make(map[string]*client, count)
			for i := 0; i < count; i++ {
				id := fmt.Sprintf("client_%d", i)
				clients[id] = &client{id: id, send: make(chan []byte, 1)}
			}
			hub.rooms[room.ID] = &roomState{clients: clients}
			data := []byte(`{"type":"chat.message"}`)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				hub.broadcastLocal(room.ID, data, "")
				b.StopTimer()
				for _, c := range clients {
					<-c.send
				}
				b.StartTimer()
			}
		})
	}
}
