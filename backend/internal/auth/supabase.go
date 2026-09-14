package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"loft/backend/internal/domain"
)

type userClaims struct {
	Email        string `json:"email"`
	Role         string `json:"role"`
	UserMetadata struct {
		Name      string `json:"name"`
		FullName  string `json:"full_name"`
		AvatarURL string `json:"avatar_url"`
	} `json:"user_metadata"`
	jwt.RegisteredClaims
}

type jwksResponse struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		N   string `json:"n"`
		E   string `json:"e"`
		Crv string `json:"crv"`
		X   string `json:"x"`
		Y   string `json:"y"`
	} `json:"keys"`
}

type SupabaseVerifier struct {
	issuer, audience string
	hmacSecret       []byte
	client           *http.Client
	mu               sync.RWMutex
	keys             map[string]any
	keysExpireAt     time.Time
	refreshAfter     time.Time
	refreshing       chan struct{}
}

func NewSupabaseVerifier(url, audience, hmacSecret string) *SupabaseVerifier {
	return &SupabaseVerifier{
		issuer: strings.TrimRight(url, "/") + "/auth/v1", audience: audience,
		hmacSecret: []byte(hmacSecret), client: &http.Client{Timeout: 5 * time.Second}, keys: make(map[string]any),
	}
}

func (v *SupabaseVerifier) Verify(ctx context.Context, raw string) (domain.Identity, error) {
	claims := new(userClaims)
	parsed, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		switch token.Method.Alg() {
		case jwt.SigningMethodHS256.Alg():
			if len(v.hmacSecret) == 0 {
				return nil, errors.New("HS256 disabled")
			}
			return v.hmacSecret, nil
		case jwt.SigningMethodRS256.Alg():
			kid, _ := token.Header["kid"].(string)
			return v.key(ctx, kid)
		case jwt.SigningMethodES256.Alg(), jwt.SigningMethodEdDSA.Alg():
			kid, _ := token.Header["kid"].(string)
			return v.key(ctx, kid)
		default:
			return nil, errors.New("unsupported Supabase JWT algorithm")
		}
	}, jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience), jwt.WithExpirationRequired())
	if err != nil || !parsed.Valid || claims.Role != "authenticated" {
		return domain.Identity{}, domain.ErrUnauthorized
	}
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return domain.Identity{}, domain.ErrUnauthorized
	}
	name := claims.UserMetadata.FullName
	if name == "" {
		name = claims.UserMetadata.Name
	}
	if name == "" {
		name = strings.Split(claims.Email, "@")[0]
	}
	name, err = domain.ValidateDisplayName(name)
	if err != nil {
		name = "Loft member"
	}
	return domain.Identity{ID: claims.Subject, Type: domain.IdentityUser, DisplayName: name, AvatarURL: claims.UserMetadata.AvatarURL}, nil
}

func (v *SupabaseVerifier) key(ctx context.Context, kid string) (any, error) {
	if kid == "" {
		return nil, errors.New("JWT key not found")
	}
	v.mu.Lock()
	key, ok := v.keys[kid]
	fresh := time.Now().Before(v.keysExpireAt)
	if ok && fresh {
		v.mu.Unlock()
		return key, nil
	}
	if pending := v.refreshing; pending != nil {
		v.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-pending:
			return v.key(ctx, kid)
		}
	}
	if time.Now().Before(v.refreshAfter) {
		v.mu.Unlock()
		return nil, errors.New("JWT key unavailable")
	}
	v.refreshing = make(chan struct{})
	v.refreshAfter = time.Now().Add(30 * time.Second)
	v.mu.Unlock()
	err := v.refresh(ctx)
	v.mu.Lock()
	close(v.refreshing)
	v.refreshing = nil
	v.mu.Unlock()
	if err != nil {
		return nil, err
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok = v.keys[kid]
	if !ok {
		return nil, errors.New("JWT key not found")
	}
	return key, nil
}

func (v *SupabaseVerifier) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.issuer+"/.well-known/jwks.json", nil)
	if err != nil {
		return err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("Supabase JWKS unavailable")
	}
	var payload jwksResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return err
	}
	keys := make(map[string]any, len(payload.Keys))
	for _, item := range payload.Keys {
		switch item.Kty {
		case "RSA":
			nBytes, errN := base64.RawURLEncoding.DecodeString(item.N)
			eBytes, errE := base64.RawURLEncoding.DecodeString(item.E)
			if errN != nil || errE != nil {
				continue
			}
			e := 0
			for _, b := range eBytes {
				e = e<<8 + int(b)
			}
			keys[item.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}
		case "EC":
			if item.Crv != "P-256" {
				continue
			}
			xBytes, errX := base64.RawURLEncoding.DecodeString(item.X)
			yBytes, errY := base64.RawURLEncoding.DecodeString(item.Y)
			if errX != nil || errY != nil {
				continue
			}
			key := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(xBytes), Y: new(big.Int).SetBytes(yBytes)}
			if key.Curve.IsOnCurve(key.X, key.Y) {
				keys[item.Kid] = key
			}
		case "OKP":
			if item.Crv != "Ed25519" {
				continue
			}
			xBytes, err := base64.RawURLEncoding.DecodeString(item.X)
			if err == nil && len(xBytes) == ed25519.PublicKeySize {
				keys[item.Kid] = ed25519.PublicKey(xBytes)
			}
		}
	}
	if len(keys) == 0 {
		return errors.New("Supabase JWKS contains no supported keys")
	}
	v.mu.Lock()
	v.keys = keys
	v.keysExpireAt = time.Now().Add(10 * time.Minute)
	v.mu.Unlock()
	return nil
}
