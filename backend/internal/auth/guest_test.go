package auth

import (
	"testing"
	"time"
)

func TestGuestTokenScopeAndTamper(t *testing.T) {
	service := NewGuestTokens("12345678901234567890123456789012", time.Hour)
	raw, issued, _, err := service.Issue("room-1", "Minh")
	if err != nil {
		t.Fatal(err)
	}
	verified, err := service.Verify(raw)
	if err != nil || verified.ID != issued.ID || verified.RoomID != "room-1" {
		t.Fatalf("verification failed: %#v %v", verified, err)
	}
	if _, err := service.Verify(raw + "x"); err == nil {
		t.Fatal("tampered token accepted")
	}
}

func TestExpiredGuestRejected(t *testing.T) {
	service := NewGuestTokens("12345678901234567890123456789012", -time.Hour)
	token, _, _, err := service.Issue("room-1", "QA 👋")
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{token, "", "malformed"} {
		if _, err := service.Verify(raw); err == nil {
			t.Fatal("invalid guest credential accepted")
		}
	}
}
