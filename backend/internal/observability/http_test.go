package observability

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestClientIPTrustsOnlyConfiguredProxies(t *testing.T) {
	for _, tc := range []struct{ peer, forwarded, want string }{
		{"192.0.2.5:443", "203.0.113.1", "192.0.2.5"},
		{"10.0.0.2:443", "203.0.113.1, 192.0.2.5, 10.0.0.1", "192.0.2.5"},
		{"10.0.0.2:443", "203.0.113.1, invalid", "10.0.0.2"},
	} {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = tc.peer
		req.Header.Set("X-Forwarded-For", tc.forwarded)
		req.Header.Set("X-Real-IP", "203.0.113.9")
		TrustedProxyMiddleware([]netip.Prefix{netip.MustParsePrefix("10.0.0.0/24")})(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			if got := ClientIP(r); got != tc.want {
				t.Fatalf("peer %s: got %s, want %s", tc.peer, got, tc.want)
			}
		})).ServeHTTP(httptest.NewRecorder(), req)
	}
}
