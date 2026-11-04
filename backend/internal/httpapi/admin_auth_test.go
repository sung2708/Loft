package httpapi

import (
	"io"
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
