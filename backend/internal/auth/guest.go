package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"loft/backend/internal/domain"
)

type GuestClaims struct {
	RoomID      string `json:"room_id"`
	DisplayName string `json:"display_name"`
	jwt.RegisteredClaims
}

type GuestTokens struct {
	secret []byte
	ttl    time.Duration
}

func NewGuestTokens(secret string, ttl time.Duration) *GuestTokens {
	return &GuestTokens{secret: []byte(secret), ttl: ttl}
}

func (g *GuestTokens) Issue(roomID, displayName string) (string, domain.Identity, time.Time, error) {
	guestID := uuid.NewString()
	expiresAt := time.Now().UTC().Add(g.ttl)
	claims := GuestClaims{
		RoomID: roomID, DisplayName: displayName,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: guestID, Issuer: "loft-api", Audience: jwt.ClaimStrings{"loft-guest"},
			IssuedAt: jwt.NewNumericDate(time.Now().UTC()), ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(g.secret)
	return token, domain.Identity{ID: guestID, Type: domain.IdentityGuest, DisplayName: displayName, RoomID: roomID}, expiresAt, err
}

func (g *GuestTokens) Verify(raw string) (domain.Identity, error) {
	claims := new(GuestClaims)
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected guest token algorithm")
		}
		return g.secret, nil
	}, jwt.WithAudience("loft-guest"), jwt.WithIssuer("loft-api"), jwt.WithExpirationRequired())
	if err != nil || !token.Valid || claims.Subject == "" || claims.RoomID == "" {
		return domain.Identity{}, domain.ErrUnauthorized
	}
	return domain.Identity{ID: claims.Subject, Type: domain.IdentityGuest, DisplayName: claims.DisplayName, RoomID: claims.RoomID}, nil
}
