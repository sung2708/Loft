package config

import (
	"errors"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"loft/backend/internal/spotify"
)

type Config struct {
	Address              string
	DatabaseURL          string
	SupabaseURL          string
	SupabaseJWTSecret    string
	SupabaseAudience     string
	LiveKitURL           string
	LiveKitAPIKey        string
	LiveKitAPISecret     string
	FrontendOrigins      []string
	FrontendURL          string
	GuestTokenSecret     string
	GuestTokenTTL        time.Duration
	ShutdownTimeout      time.Duration
	RedisURL             string
	InstanceID           string
	SpotifyClientID      string
	SpotifyRedirectURI   string
	SpotifyEnabled       bool
	SpotifyCredentialKey string
	YouTubeAPIKey        string
	YouTubeEnabled       bool
}

func Load() (Config, error) {
	cfg := Config{
		Address:              env("HTTP_ADDR", ":8080"),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		SupabaseURL:          strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseJWTSecret:    os.Getenv("SUPABASE_JWT_SECRET"),
		SupabaseAudience:     env("SUPABASE_JWT_AUDIENCE", "authenticated"),
		LiveKitURL:           os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:        os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:     os.Getenv("LIVEKIT_API_SECRET"),
		FrontendOrigins:      splitCSV(env("FRONTEND_ORIGINS", "http://localhost:3000")),
		FrontendURL:          strings.TrimRight(os.Getenv("FRONTEND_URL"), "/"),
		GuestTokenSecret:     os.Getenv("GUEST_TOKEN_SECRET"),
		GuestTokenTTL:        12 * time.Hour,
		ShutdownTimeout:      15 * time.Second,
		RedisURL:             os.Getenv("REDIS_URL"),
		InstanceID:           env("INSTANCE_ID", ""),
		SpotifyClientID:      os.Getenv("SPOTIFY_CLIENT_ID"),
		SpotifyRedirectURI:   os.Getenv("SPOTIFY_REDIRECT_URI"),
		SpotifyEnabled:       env("SPOTIFY_ENABLED", "false") == "true",
		SpotifyCredentialKey: os.Getenv("SPOTIFY_CREDENTIAL_KEY"),
		YouTubeAPIKey:        os.Getenv("YOUTUBE_API_KEY"),
		YouTubeEnabled:       env("YOUTUBE_ENABLED", "true") == "true",
	}
	if cfg.DatabaseURL == "" || cfg.SupabaseURL == "" || cfg.GuestTokenSecret == "" {
		return Config{}, errors.New("DATABASE_URL, SUPABASE_URL and GUEST_TOKEN_SECRET are required")
	}
	if len(cfg.GuestTokenSecret) < 32 {
		return Config{}, errors.New("GUEST_TOKEN_SECRET must contain at least 32 characters")
	}
	if cfg.FrontendURL == "" && len(cfg.FrontendOrigins) > 0 {
		cfg.FrontendURL = strings.TrimRight(cfg.FrontendOrigins[0], "/")
	}
	if !contains(cfg.FrontendOrigins, cfg.FrontendURL) || !validOrigin(cfg.FrontendURL) {
		return Config{}, errors.New("FRONTEND_URL must be an exact origin listed in FRONTEND_ORIGINS")
	}
	if cfg.SpotifyEnabled {
		if cfg.SpotifyCredentialKey == "" || cfg.SpotifyClientID == "" || cfg.SpotifyRedirectURI == "" {
			return Config{}, errors.New("SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI and SPOTIFY_CREDENTIAL_KEY are required when SPOTIFY_ENABLED=true")
		}
		if cfg.RedisURL == "" {
			return Config{}, errors.New("REDIS_URL is required when SPOTIFY_ENABLED=true")
		}
		if _, err := spotify.DecodeCredentialKey(cfg.SpotifyCredentialKey); err != nil {
			return Config{}, errors.New("SPOTIFY_CREDENTIAL_KEY must decode to a 32-byte encryption key")
		}
		if !validSpotifyRedirectURI(cfg.SpotifyRedirectURI) {
			return Config{}, errors.New("SPOTIFY_REDIRECT_URI must use HTTPS, or an explicit loopback IP over HTTP, and end in /api/v1/spotify/callback")
		}
	}
	return cfg, nil
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if strings.TrimRight(value, "/") == wanted {
			return true
		}
	}
	return false
}

func validOrigin(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.User == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}

func validSpotifyRedirectURI(value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.Host == "" || u.Path != "/api/v1/spotify/callback" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	if u.Scheme != "http" {
		return false
	}
	ip := net.ParseIP(u.Hostname())
	return ip != nil && ip.IsLoopback()
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
