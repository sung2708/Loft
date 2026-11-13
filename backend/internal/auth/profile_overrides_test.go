package auth

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"loft/backend/internal/domain"
)

type countingOverrides struct {
	calls atomic.Int32
	value domain.ProfileOverrides
	err   error
}

func (c *countingOverrides) ProfileOverrides(context.Context, string) (domain.ProfileOverrides, error) {
	c.calls.Add(1)
	return c.value, c.err
}

func TestVerifierAppliesFreshProfileOverridesAndAAL(t *testing.T) {
	const secret = "12345678901234567890123456789012"
	verifier := NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)
	source := &countingOverrides{value: domain.ProfileOverrides{DisplayName: "Chosen", HideAvatar: true}}
	verifier.SetProfileOverrides(source)
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "11111111-1111-4111-8111-111111111111", "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated",
		"exp": time.Now().Add(time.Hour).Unix(), "aal": "aal2", "user_metadata": map[string]any{"full_name": "Provider Name", "avatar_url": "https://a"},
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		identity, err := verifier.Verify(context.Background(), token)
		if err != nil || identity.DisplayName != "Chosen" || identity.AvatarURL != "" || identity.AAL != "aal2" {
			t.Fatalf("identity = %+v, %v", identity, err)
		}
	}
	if calls := source.calls.Load(); calls != 3 {
		t.Fatalf("source called %d times, want fresh lookups", calls)
	}
	source.value = domain.ProfileOverrides{}
	if identity, _ := verifier.Verify(context.Background(), token); identity.DisplayName != "Provider Name" || identity.AvatarURL != "https://a" {
		t.Fatalf("after reset: %+v", identity)
	}
	// Lookup failures fall back to the provider name and omit the avatar.
	failing := NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)
	failing.SetProfileOverrides(&countingOverrides{err: errors.New("db down")})
	if identity, err := failing.Verify(context.Background(), token); err != nil || identity.DisplayName != "Provider Name" || identity.AvatarURL != "" {
		t.Fatalf("fail open: %+v, %v", identity, err)
	}
}
