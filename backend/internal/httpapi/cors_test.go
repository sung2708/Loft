package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSAllowsConfiguredMinglyOriginsOnly(t *testing.T) {
	server := &Server{origins: map[string]struct{}{
		"https://mingly.site":     {},
		"https://www.mingly.site": {},
		"http://localhost:3000":   {},
	}}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	tests := []struct {
		name            string
		origin          string
		method          string
		wantStatus      int
		wantAllowOrigin string
		wantNextCalled  bool
		requestMethod   string
	}{
		{name: "apex patch preflight", origin: "https://mingly.site", method: http.MethodOptions, requestMethod: http.MethodPatch, wantStatus: http.StatusNoContent, wantAllowOrigin: "https://mingly.site"},
		{name: "www patch preflight", origin: "https://www.mingly.site", method: http.MethodOptions, requestMethod: http.MethodPatch, wantStatus: http.StatusNoContent, wantAllowOrigin: "https://www.mingly.site"},
		{name: "localhost request", origin: "http://localhost:3000", method: http.MethodGet, wantStatus: http.StatusOK, wantAllowOrigin: "http://localhost:3000", wantNextCalled: true},
		{name: "unknown preflight", origin: "https://evil.example", method: http.MethodOptions, wantStatus: http.StatusForbidden},
		{name: "similar hostname", origin: "https://evilmingly.site", method: http.MethodOptions, wantStatus: http.StatusForbidden},
		{name: "preview hostname", origin: "https://random-preview.vercel.app", method: http.MethodOptions, wantStatus: http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			wrapped := server.cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				next.ServeHTTP(w, r)
			}))
			req := httptest.NewRequest(test.method, "/api/v1/users/me", nil)
			req.Header.Set("Origin", test.origin)
			if test.method == http.MethodOptions {
				requestMethod := test.requestMethod
				if requestMethod == "" {
					requestMethod = http.MethodGet
				}
				req.Header.Set("Access-Control-Request-Method", requestMethod)
				req.Header.Set("Access-Control-Request-Headers", "Authorization, Content-Type")
			}
			response := httptest.NewRecorder()
			wrapped.ServeHTTP(response, req)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if got := response.Header().Get("Access-Control-Allow-Origin"); got != test.wantAllowOrigin {
				t.Fatalf("allow-origin = %q, want %q", got, test.wantAllowOrigin)
			}
			if test.requestMethod == http.MethodPatch {
				if got := response.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, PATCH, DELETE, OPTIONS" {
					t.Fatalf("allow-methods = %q, want PATCH allowlist", got)
				}
			}
			if called != test.wantNextCalled {
				t.Fatalf("next called = %v, want %v", called, test.wantNextCalled)
			}
		})
	}
}
