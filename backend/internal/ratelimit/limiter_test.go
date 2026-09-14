package ratelimit

import (
	"fmt"
	"testing"
	"time"
)

func TestLimiterBoundsKeyStorage(t *testing.T) {
	limiter := New(1, time.Minute, 1)
	for i := 0; i < 5000; i++ {
		limiter.Allow(fmt.Sprintf("client-%d", i))
	}
	if len(limiter.entries) > 4096 {
		t.Fatalf("limiter retained %d keys", len(limiter.entries))
	}
}

func TestLimiterEnforcesBurst(t *testing.T) {
	limiter := New(1, time.Hour, 2)
	if !limiter.Allow("client") || !limiter.Allow("client") || limiter.Allow("client") {
		t.Fatal("unexpected burst behavior")
	}
}
