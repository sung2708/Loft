package realtime

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

type suspensionStore struct {
	realtimeStore
	ban *domain.AccountBan
}

func (s *suspensionStore) ActiveAccountBan(context.Context, string) (*domain.AccountBan, error) {
	return s.ban, nil
}
func (*suspensionStore) BanAccount(context.Context, domain.AccountBan) error  { return nil }
func (*suspensionStore) LiftAccountBan(context.Context, string, string) error { return nil }
func (*suspensionStore) ListAdminAudit(context.Context, domain.AdminAuditFilter, int, int) ([]domain.AdminAuditEntry, int, error) {
	return nil, 0, nil
}

type suspensionEvictor struct{ removed []string }

func (e *suspensionEvictor) RemoveParticipant(_ context.Context, roomID, identity string) error {
	e.removed = append(e.removed, roomID+":"+identity)
	return nil
}

func TestSuspensionReachesOtherNodeAndRecoversWithoutBus(t *testing.T) {
	for _, tc := range []struct {
		name               string
		delivered, deleted bool
	}{
		{"suspension via bus", true, false},
		{"suspension via periodic check", false, false},
		{"deletion via bus", true, true},
		{"deletion via periodic check", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			accepted := make(chan *websocket.Conn, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := websocket.Accept(w, r, nil)
				if err == nil {
					accepted <- conn
				}
			}))
			defer server.Close()
			remote, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer remote.CloseNow()
			conn := <-accepted
			defer conn.CloseNow()
			store := &suspensionStore{}
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			users := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", "")
			users.SetAccountLookup(func(context.Context, string) (bool, error) { return !tc.deleted, nil })
			a, b := New(store, nil, users, nil, logger), New(store, nil, users, nil, logger)
			actor := domain.Identity{ID: "user", Type: domain.IdentityUser}
			if err := b.bans.Check(ctx, actor); err != nil {
				t.Fatal(err)
			}
			evictor := &suspensionEvictor{}
			b.evictor = evictor
			b.rooms["room"] = &roomState{clients: map[string]*client{"c": {conn: conn, identity: actor, roomID: "room"}}}
			busA, busB := &memoryBus{instanceID: "a"}, &memoryBus{instanceID: "b", deliver: b.DeliverRemote}
			busA.peers = []*memoryBus{busB}
			a.SetBus(busA)
			code := "UNAUTHORIZED"
			if !tc.deleted {
				store.ban = &domain.AccountBan{UserID: actor.ID}
				code = "ACCOUNT_SUSPENDED"
			}
			if tc.delivered {
				a.DisconnectUser(ctx, actor.ID)
			} else {
				_ = b.checkAccountAccess(ctx, actor)
			}
			var event Envelope
			if err := wsjson.Read(ctx, remote, &event); err != nil {
				t.Fatal(err)
			}
			if event.Type != "error" || !strings.Contains(string(event.Payload), code) {
				t.Fatalf("unexpected event: %+v", event)
			}
			if len(evictor.removed) != 1 || evictor.removed[0] != "room:user:user" {
				t.Fatalf("media not evicted: %v", evictor.removed)
			}
		})
	}
}
