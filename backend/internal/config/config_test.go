package config

import (
	"strings"
	"testing"
)

func setRequiredEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/mingly")
	t.Setenv("SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("GUEST_TOKEN_SECRET", "01234567890123456789012345678901")
	t.Setenv("FRONTEND_ORIGINS", "https://mingly.site,https://www.mingly.site")
	t.Setenv("FRONTEND_URL", "https://mingly.site")
	t.Setenv("SPOTIFY_ENABLED", "false")
}

func TestLoadRejectsFrontendURLOutsideAllowedOrigins(t *testing.T) {
	setRequiredEnvironment(t)
	t.Setenv("FRONTEND_URL", "https://evil.example")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "FRONTEND_URL") {
		t.Fatalf("expected frontend origin validation error, got %v", err)
	}
}

func TestLoadSpotifyRequiresRedisAndBackendCallback(t *testing.T) {
	setRequiredEnvironment(t)
	t.Setenv("SPOTIFY_ENABLED", "true")
	t.Setenv("SPOTIFY_CLIENT_ID", "client-id")
	t.Setenv("SPOTIFY_CREDENTIAL_KEY", "01234567890123456789012345678901")
	t.Setenv("SPOTIFY_REDIRECT_URI", "https://api.mingly.site/api/v1/spotify/callback")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_URL") {
		t.Fatalf("expected Redis validation error, got %v", err)
	}

	t.Setenv("REDIS_URL", "redis://localhost:6379/0")
	t.Setenv("SPOTIFY_REDIRECT_URI", "http://mingly.site/api/v1/spotify/callback")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "SPOTIFY_REDIRECT_URI") {
		t.Fatalf("expected callback validation error, got %v", err)
	}

	t.Setenv("SPOTIFY_REDIRECT_URI", "https://api.mingly.site/api/v1/spotify/callback")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.FrontendURL != "https://mingly.site" {
		t.Fatalf("FrontendURL = %q", cfg.FrontendURL)
	}
}
