package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSupabaseVerifierAcceptsES256JWKS(t *testing.T) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := func(value *big.Int) string {
		return base64.RawURLEncoding.EncodeToString(value.FillBytes(make([]byte, 32)))
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/.well-known/jwks.json" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kid": "test-key", "kty": "EC", "crv": "P-256", "x": encode(privateKey.X), "y": encode(privateKey.Y)}}})
	}))
	defer server.Close()
	claims := userClaims{RegisteredClaims: jwt.RegisteredClaims{Subject: "4ff036f8-834c-4cb5-9097-30710442e19e", Issuer: server.URL + "/auth/v1", Audience: jwt.ClaimStrings{"authenticated"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
	claims.Email = "minh@example.com"
	claims.Role = "authenticated"
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	token.Header["kid"] = "test-key"
	raw, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewSupabaseVerifier(server.URL, "authenticated", "")
	identity, err := verifier.Verify(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if identity.ID != claims.Subject || identity.DisplayName != "minh" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
	for _, test := range []struct {
		name   string
		change func(*userClaims)
	}{
		{"expired", func(c *userClaims) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour)) }},
		{"missing-expiry", func(c *userClaims) { c.ExpiresAt = nil }},
		{"wrong-issuer", func(c *userClaims) { c.Issuer = "https://evil.invalid" }},
		{"wrong-audience", func(c *userClaims) { c.Audience = jwt.ClaimStrings{"other"} }},
		{"wrong-role", func(c *userClaims) { c.Role = "anon" }},
		{"forged-subject", func(c *userClaims) { c.Subject = "not-a-user-id" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			invalid := claims
			test.change(&invalid)
			token := jwt.NewWithClaims(jwt.SigningMethodES256, invalid)
			token.Header["kid"] = "test-key"
			raw, err := token.SignedString(privateKey)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := verifier.Verify(context.Background(), raw); err == nil {
				t.Fatal("invalid claims accepted")
			}
		})
	}
	otherKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	for _, kid := range []string{"test-key", "unknown"} {
		token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
		token.Header["kid"] = kid
		forged, err := token.SignedString(otherKey)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := verifier.Verify(context.Background(), forged); err == nil {
			t.Fatal("forged signature/key accepted")
		}
	}
	for _, raw := range []string{"", "malformed.jwt", "a.b.c"} {
		if _, err := verifier.Verify(context.Background(), raw); err == nil {
			t.Fatal("malformed credential accepted")
		}
	}
}

func TestUnknownKeyBurstIsBounded(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	v := NewSupabaseVerifier(server.URL, "authenticated", "")
	var workers sync.WaitGroup
	for i := 0; i < 50; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if _, err := v.key(context.Background(), "unknown"); err == nil {
				t.Error("unknown key accepted")
			}
		}()
	}
	workers.Wait()
	if requests.Load() != 1 {
		t.Fatalf("JWKS burst made %d requests", requests.Load())
	}
}
