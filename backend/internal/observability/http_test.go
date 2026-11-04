package observability

import (
	"net/http/httptest"
	"testing"
)

func TestClientIPUsesValidForwardedAddress(t *testing.T) {
	for _, tc := range []struct {
		name   string
		xff    string
		xReal  string
		remote string
		want   string
	}{
		{name: "forwarded first hop", xff: "203.0.113.8, 10.0.0.1", remote: "10.0.0.2:443", want: "203.0.113.8"},
		{name: "valid real IP fallback", xff: "invalid", xReal: "203.0.113.9", remote: "10.0.0.2:443", want: "203.0.113.9"},
		{name: "peer fallback", xff: "invalid", xReal: "invalid", remote: "10.0.0.2:443", want: "10.0.0.2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/", nil)
			request.RemoteAddr = tc.remote
			request.Header.Set("X-Forwarded-For", tc.xff)
			request.Header.Set("X-Real-IP", tc.xReal)
			if got := ClientIP(request); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
