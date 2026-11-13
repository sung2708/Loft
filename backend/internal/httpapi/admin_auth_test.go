package httpapi

import (
	"context"
	"io"
	"loft/backend/internal/domain"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/auth"
	"loft/backend/internal/livekit"
)

func TestAdminRoutesRequireAllowlistedUser(t *testing.T) {
	const secret = "12345678901234567890123456789012"
	const adminID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	const userID = "11111111-1111-4111-8111-111111111111"
	server := New(new(fakeStore), auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), nil, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server.ConfigureAdminUserIDs([]string{adminID})
	handler := server.Routes(http.NotFoundHandler())
	tokenFor := func(userID string) string {
		t.Helper()
		claims := jwt.MapClaims{"sub": userID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix()}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	for _, tc := range []struct {
		name   string
		token  string
		status int
	}{
		{name: "anonymous", status: http.StatusUnauthorized},
		{name: "authenticated non-admin", token: tokenFor(userID), status: http.StatusForbidden},
		{name: "allowlisted admin", token: tokenFor(adminID), status: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/overview", nil)
			if tc.token != "" {
				request.Header.Set("Authorization", "Bearer "+tc.token)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("got %d, want %d: %s", response.Code, tc.status, response.Body.String())
			}
		})
	}
}

type adminFixture struct {
	*fakeStore
	query, status, owner string
}

func (*adminFixture) AdminOverview(context.Context) (domain.AdminOverview, error) {
	return domain.AdminOverview{}, nil
}
func (*adminFixture) ListAdminUsers(context.Context, string, domain.AdminUserStatus, int, int) ([]domain.AdminUser, int, error) {
	return []domain.AdminUser{}, 0, nil
}
func (f *adminFixture) ListAdminRooms(_ context.Context, query, status, owner string, _, _ int) ([]domain.AdminRoom, int, error) {
	f.query, f.status, f.owner = query, status, owner
	return []domain.AdminRoom{}, 0, nil
}

func TestAdminRoomFiltersValidateBeforeStore(t *testing.T) {
	const adminID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	const secret = "12345678901234567890123456789012"
	fixture := &adminFixture{fakeStore: new(fakeStore)}
	server := New(fixture, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), nil, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server.ConfigureAdminUserIDs([]string{adminID})
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": adminID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix()}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"status=invalid", 400}, {"owner=invalid", 400}, {"limit=51", 400}, {"offset=-1", 400},
		{"status=ended&owner=" + adminID + "&q=hello", 200},
	} {
		t.Run(tc.query, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/v1/admin/rooms?"+tc.query, nil)
			r.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			server.Routes(http.NotFoundHandler()).ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
	if fixture.status != "ended" || fixture.owner != adminID || fixture.query != "hello" {
		t.Fatalf("filters lost: %+v", fixture)
	}
}
