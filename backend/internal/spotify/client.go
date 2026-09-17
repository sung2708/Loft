package spotify

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type TokenRefresher struct {
	ClientID string
	HTTP     *http.Client
}
type TokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

// Refresh exchanges a refresh token and preserves the old refresh token when Spotify omits rotation.
func (c TokenRefresher) Refresh(ctx context.Context, refreshToken string) (TokenResult, error) {
	if c.ClientID == "" || refreshToken == "" {
		return TokenResult{}, fmt.Errorf("spotify refresh is not configured")
	}
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 8 * time.Second}
	}
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}, "client_id": {c.ClientID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://accounts.spotify.com/api/token", strings.NewReader(form.Encode()))
	if err != nil {
		return TokenResult{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := hc.Do(req)
	if err != nil {
		return TokenResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return TokenResult{}, fmt.Errorf("spotify token refresh status %d", resp.StatusCode)
	}
	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil || payload.AccessToken == "" {
		return TokenResult{}, fmt.Errorf("invalid spotify refresh response")
	}
	if payload.RefreshToken == "" {
		payload.RefreshToken = refreshToken
	}
	return TokenResult{AccessToken: payload.AccessToken, RefreshToken: payload.RefreshToken, ExpiresAt: time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)}, nil
}
