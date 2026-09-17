package spotify

import (
	"testing"
	"time"
)

func TestNormalizeError(t *testing.T) {
	for _, tc := range []struct {
		status int
		quota  bool
		want   ErrorKind
	}{
		{401, false, ErrorAuth}, {403, false, ErrorForbidden},
		{429, false, ErrorRateLimited}, {429, true, ErrorQuota},
		{500, false, ErrorUnavailable},
	} {
		err := NormalizeError(tc.status, 2*time.Second, tc.quota, "provider error")
		if err.Kind != tc.want || err.RetryAfter != 2*time.Second {
			t.Fatalf("status %d quota %v: got %#v", tc.status, tc.quota, err)
		}
	}
}
