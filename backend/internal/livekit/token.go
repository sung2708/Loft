package livekit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/domain"
)

type TokenService struct {
	apiKey, apiSecret string
	serverURL         string
	client            *http.Client
}

type videoGrant struct {
	RoomJoin          bool     `json:"roomJoin"`
	RoomAdmin         bool     `json:"roomAdmin,omitempty"`
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
	return &TokenService{apiKey: apiKey, apiSecret: apiSecret, client: &http.Client{Timeout: 3 * time.Second}}
}

func (s *TokenService) SetURL(raw string) error {
	if raw == "" {
		s.serverURL = ""
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	switch u.Scheme {
	case "wss":
		u.Scheme = "https"
	case "ws":
		u.Scheme = "http"
	case "https", "http":
	default:
		return errors.New("invalid LiveKit URL scheme")
	}
	if u.Host == "" {
		return errors.New("invalid LiveKit URL host")
	}
	u.Path = ""
	u.RawQuery = ""
	u.Fragment = ""
	s.serverURL = u.String()
	return nil
}

func (s *TokenService) RemoveParticipant(ctx context.Context, room, identity string) error {
	if s.serverURL == "" || s.apiKey == "" || s.apiSecret == "" {
		return errors.New("LiveKit management unavailable")
	}
	now := time.Now().UTC()
	admin := claims{Video: videoGrant{RoomAdmin: true, Room: room}, RegisteredClaims: jwt.RegisteredClaims{
		Issuer: s.apiKey, NotBefore: jwt.NewNumericDate(now), IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute)),
	}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, admin).SignedString([]byte(s.apiSecret))
	if err != nil {
		return err
	}
	body, err := json.Marshal(struct {
		Room          string `json:"room"`
		Identity      string `json:"identity"`
		RevokeTokenTS int64  `json:"revoke_token_ts"`
	}{room, identity, now.Unix()})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.serverURL+"/twirp/livekit.RoomService/RemoveParticipant", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
		return fmt.Errorf("LiveKit remove participant returned %d", response.StatusCode)
	}
	return nil
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
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(10 * time.Minute)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, grant).SignedString([]byte(s.apiSecret))
}
