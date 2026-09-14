package livekit

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/domain"
)

type TokenService struct{ apiKey, apiSecret string }

type videoGrant struct {
	RoomJoin          bool     `json:"roomJoin"`
	Room              string   `json:"room"`
	CanPublish        bool     `json:"canPublish"`
	CanSubscribe      bool     `json:"canSubscribe"`
	CanPublishData    bool     `json:"canPublishData"`
	CanPublishSources []string `json:"canPublishSources"`
}

type claims struct {
	Name     string     `json:"name"`
	Metadata string     `json:"metadata"`
	Video    videoGrant `json:"video"`
	jwt.RegisteredClaims
}

func New(apiKey, apiSecret string) *TokenService {
	return &TokenService{apiKey: apiKey, apiSecret: apiSecret}
}

func (s *TokenService) Create(room domain.Room, identity domain.Identity) (string, error) {
	if s.apiKey == "" || s.apiSecret == "" {
		return "", errors.New("LiveKit is not configured")
	}
	now := time.Now().UTC()
	metadata, _ := json.Marshal(map[string]string{
		"display_name":  identity.DisplayName,
		"avatar_url":    identity.AvatarURL,
		"identity_type": string(identity.Type),
	})
	grant := claims{
		Name:     identity.DisplayName,
		Metadata: string(metadata),
		Video: videoGrant{
			RoomJoin: true, Room: room.ID, CanPublish: true, CanSubscribe: true, CanPublishData: true,
			CanPublishSources: []string{"microphone", "camera", "screen_share", "screen_share_audio"},
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: s.apiKey, Subject: identity.LiveKitIdentity(), NotBefore: jwt.NewNumericDate(now),
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, grant).SignedString([]byte(s.apiSecret))
}
