package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
)

type banFixture struct {
	adminFixture
	mu     sync.Mutex
	bans   map[string]domain.AccountBan
	audit  []domain.AdminAuditEntry
	kicked []string
}

func (f *banFixture) ActiveAccountBan(_ context.Context, userID string) (*domain.AccountBan, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ban, ok := f.bans[userID]; ok && ban.Active(time.Now()) {
		return &ban, nil
	}
	return nil, nil
}
func (f *banFixture) BanAccount(_ context.Context, ban domain.AccountBan) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.bans[ban.UserID] = ban
	f.audit = append(f.audit, domain.AdminAuditEntry{Action: "account.suspend", TargetID: ban.UserID})
	return nil
}
func (f *banFixture) LiftAccountBan(_ context.Context, userID, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.bans[userID]; !ok {
		return domain.ErrNotFound
	}
	delete(f.bans, userID)
	f.audit = append(f.audit, domain.AdminAuditEntry{Action: "account.unsuspend", TargetID: userID})
	return nil
}
func (f *banFixture) ListAdminAudit(context.Context, domain.AdminAuditFilter, int, int) ([]domain.AdminAuditEntry, int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]domain.AdminAuditEntry(nil), f.audit...), len(f.audit), nil
}

type kickRecorder struct {
	fakeDeletionGuard
	kicked []string
}

func (k *kickRecorder) DisconnectUser(_ context.Context, userID string) {
	k.kicked = append(k.kicked, userID)
}
func (k *kickRecorder) InvalidateSuspension(string) {}

func TestAccountSuspensionLifecycle(t *testing.T) {
	const secret = "12345678901234567890123456789012"
	const adminID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	const userID = "9b2d5c1e-8a14-4c3f-9e7a-1f2b3c4d5e6f"
	token := func(sub string) string {
		raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": sub, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix()}).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	fixture := &banFixture{adminFixture: adminFixture{fakeStore: new(fakeStore)}, bans: map[string]domain.AccountBan{}}
	kicks := &kickRecorder{}
	server := New(fixture, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), nil, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)), kicks)
	server.ConfigureAdminUserIDs([]string{adminID})
	routes := server.Routes(http.NotFoundHandler())
	do := func(method, path, bearer, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+bearer)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		routes.ServeHTTP(w, r)
		return w
	}

	if w := do("GET", "/api/v1/users/me", token(userID), ""); w.Code == http.StatusForbidden {
		t.Fatalf("user blocked before suspension: %s", w.Body.String())
	}
	for _, target := range []string{strings.ToUpper(adminID), strings.ReplaceAll(adminID, "-", ""), "{" + adminID + "}"} {
		if w := do("POST", "/api/v1/admin/users/"+target+"/suspension", token(adminID), `{"reason":"spam","note":"self suspension test","days":1}`); w.Code != http.StatusForbidden {
			t.Fatalf("noncanonical admin target accepted: %s (%d)", target, w.Code)
		}
	}
	// Admins cannot suspend themselves; non-admins cannot suspend anyone.
	if w := do("POST", "/api/v1/admin/users/"+adminID+"/suspension", token(adminID), `{"reason":"spam","note":"self suspension test","days":1}`); w.Code != http.StatusForbidden {
		t.Fatalf("self suspension allowed: %d", w.Code)
	}
	if w := do("POST", "/api/v1/admin/users/"+adminID+"/suspension", token(userID), `{"reason":"spam","note":"not an admin at all","days":1}`); w.Code != http.StatusForbidden {
		t.Fatalf("non-admin suspension allowed: %d", w.Code)
	}
	if w := do("POST", "/api/v1/admin/users/"+userID+"/suspension", token(adminID), `{"reason":"spam","note":"short","days":1}`); w.Code != http.StatusBadRequest {
		t.Fatalf("short note accepted: %d", w.Code)
	}
	if w := do("POST", "/api/v1/admin/users/"+strings.ToUpper(userID)+"/suspension", token(adminID), `{"reason":"spam","note":"repeated scam links in chat","days":7}`); w.Code != http.StatusOK {
		t.Fatalf("suspend failed: %d %s", w.Code, w.Body.String())
	}
	if len(kicks.kicked) != 1 || kicks.kicked[0] != userID {
		t.Fatalf("live sessions not disconnected: %v", kicks.kicked)
	}
	// Enforced immediately on this instance (cache invalidated).
	w := do("GET", "/api/v1/users/me", token(userID), "")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "ACCOUNT_SUSPENDED") {
		t.Fatalf("suspended user not blocked: %d %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"reason":"spam"`) ||
		!strings.Contains(body, `"expires_at":`) || strings.Contains(body, "repeated scam links") {
		t.Fatalf("incorrect suspension details: %s", body)
	}
	if w := do("DELETE", "/api/v1/admin/users/"+userID+"/suspension", token(adminID), ""); w.Code != http.StatusNoContent {
		t.Fatalf("lift failed: %d", w.Code)
	}
	if w := do("GET", "/api/v1/users/me", token(userID), ""); w.Code == http.StatusForbidden {
		t.Fatal("lifted suspension still enforced")
	}
	w = do("GET", "/api/v1/admin/audit", token(adminID), "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "account.suspend") || !strings.Contains(w.Body.String(), "account.unsuspend") {
		t.Fatalf("audit missing entries: %d %s", w.Code, w.Body.String())
	}
}
