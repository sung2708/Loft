package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"

	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

// chatStore is an in-memory MessageStore for realtime chat tests.
type chatStore struct {
	realtimeStore
	mu       sync.Mutex
	messages map[string]domain.Message
}

func (s *chatStore) InsertMessage(ctx context.Context, roomID string, sender domain.Identity, content string) (domain.Message, error) {
	return s.InsertMessageReply(ctx, roomID, sender, content, "")
}
func (s *chatStore) InsertMessageReply(_ context.Context, roomID string, sender domain.Identity, content, replyTo string) (domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	message := domain.Message{ID: uuid.NewString(), RoomID: roomID, SenderID: sender.ID, SenderType: sender.Type, SenderDisplayName: sender.DisplayName, Content: content, CreatedAt: time.Now()}
	if replyTo != "" {
		parent, ok := s.messages[replyTo]
		if !ok {
			return domain.Message{}, domain.ErrNotFound
		}
		message.ReplyTo = &domain.MessageReply{ID: parent.ID, SenderDisplayName: parent.SenderDisplayName, Content: parent.Content}
	}
	s.messages[message.ID] = message
	return message, nil
}
func (s *chatStore) GetMessage(_ context.Context, _ string, id string) (domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	message, ok := s.messages[id]
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	return message, nil
}
func (s *chatStore) EditMessage(_ context.Context, _ string, id string, _ domain.Identity, content string) (domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	message := s.messages[id]
	now := time.Now()
	message.Content, message.EditedAt = content, &now
	s.messages[id] = message
	return message, nil
}
func (s *chatStore) DeleteMessage(_ context.Context, _ string, id string, _ domain.Identity) (domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	message := s.messages[id]
	message.Content, message.Deleted = "", true
	s.messages[id] = message
	return message, nil
}

func TestChatRepliesEditsDeletesAndTyping(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Chat room", AllowGuests: true, OwnerID: uuid.NewString()}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	store := &chatStore{realtimeStore: realtimeStore{room: room}, messages: map[string]domain.Message{}}
	hub := New(store, guests, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	connect := func(name string) *websocket.Conn {
		raw, _, _, err := guests.Issue(room.ID, name)
		if err != nil {
			t.Fatal(err)
		}
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "done") })
		payload, _ := json.Marshal(authPayload{Token: raw, RoomID: room.ID})
		if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: payload}); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	send := func(conn *websocket.Conn, kind string, payload any) {
		raw, _ := json.Marshal(payload)
		if err := wsjson.Write(ctx, conn, Envelope{Type: kind, Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: raw}); err != nil {
			t.Fatal(err)
		}
	}
	// await reads until an event of one of the wanted types arrives.
	await := func(conn *websocket.Conn, types ...string) Envelope {
		for {
			var response Envelope
			if err := wsjson.Read(ctx, conn, &response); err != nil {
				t.Fatalf("waiting for %v: %v", types, err)
			}
			for _, want := range types {
				if response.Type == want {
					return response
				}
			}
		}
	}

	alice := connect("Alice")
	await(alice, "room.snapshot")
	bob := connect("Bob")
	await(bob, "room.snapshot")

	send(alice, "chat.send", chatPayload{Content: "hello"})
	var original domain.Message
	_ = json.Unmarshal(await(bob, "chat.message").Payload, &original)
	await(alice, "chat.message") // senders receive their own message too

	send(bob, "chat.send", chatPayload{Content: "hi back", ReplyToID: original.ID})
	var reply domain.Message
	_ = json.Unmarshal(await(alice, "chat.message").Payload, &reply)
	if reply.ReplyTo == nil || reply.ReplyTo.ID != original.ID || reply.ReplyTo.Content != "hello" {
		t.Fatalf("reply lost its parent: %+v", reply.ReplyTo)
	}

	// Bob is neither the author nor the room owner.
	send(bob, "chat.edit", chatEditPayload{MessageID: original.ID, Content: "hijacked"})
	if errEvent := await(bob, "error"); !strings.Contains(string(errEvent.Payload), "FORBIDDEN") {
		t.Fatalf("expected forbidden edit, got %s", errEvent.Payload)
	}
	send(bob, "chat.delete", chatDeletePayload{MessageID: original.ID})
	if errEvent := await(bob, "error"); !strings.Contains(string(errEvent.Payload), "FORBIDDEN") {
		t.Fatalf("expected forbidden delete, got %s", errEvent.Payload)
	}

	send(alice, "chat.edit", chatEditPayload{MessageID: original.ID, Content: "hello there"})
	var edited domain.Message
	_ = json.Unmarshal(await(bob, "chat.updated").Payload, &edited)
	if edited.Content != "hello there" || edited.EditedAt == nil {
		t.Fatalf("edit not broadcast: %+v", edited)
	}

	send(alice, "chat.delete", chatDeletePayload{MessageID: original.ID})
	var deleted domain.Message
	_ = json.Unmarshal(await(bob, "chat.updated").Payload, &deleted)
	if !deleted.Deleted || deleted.Content != "" {
		t.Fatalf("delete leaked content: %+v", deleted)
	}

	send(alice, "chat.typing", struct{}{})
	var typing chatTypingEvent
	_ = json.Unmarshal(await(bob, "chat.typing").Payload, &typing)
	if typing.DisplayName != "Alice" || typing.ConnectionID == "" {
		t.Fatalf("unexpected typing event: %+v", typing)
	}
	send(alice, "chat.send", chatPayload{Content: "marker"})
	// Alice must not see her own typing event before her next message.
	if got := await(alice, "chat.typing", "chat.message"); got.Type != "chat.message" {
		t.Fatal("typing echoed back to sender")
	}
}
