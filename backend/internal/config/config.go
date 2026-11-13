package config

import (
	"errors"
	"net/netip"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Config struct {
	Address            string
	DatabaseURL        string
	SupabaseURL        string
	SupabaseJWTSecret  string
	SupabaseAudience   string
	LiveKitURL         string
	LiveKitAPIKey      string
	LiveKitAPISecret   string
	FrontendOrigins    []string
	TrustedProxyCIDRs  []netip.Prefix
	AdminUserIDs       []string
	AdminRequireMFA    bool
	MetricsBearerToken string
	GuestTokenSecret   string
	GuestTokenTTL      time.Duration
	ShutdownTimeout    time.Duration
	RedisURL           string
	InstanceID         string
	YouTubeAPIKey      string
	YouTubeEnabled     bool
}

func Load() (Config, error) {
	cfg := Config{
		Address:            env("HTTP_ADDR", ":8080"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		SupabaseURL:        strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseJWTSecret:  os.Getenv("SUPABASE_JWT_SECRET"),
		SupabaseAudience:   env("SUPABASE_JWT_AUDIENCE", "authenticated"),
		LiveKitURL:         os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:      os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:   os.Getenv("LIVEKIT_API_SECRET"),
		FrontendOrigins:    splitCSV(env("FRONTEND_ORIGINS", "http://localhost:3000")),
		AdminUserIDs:       splitCSV(os.Getenv("ADMIN_USER_IDS")),
		AdminRequireMFA:    env("ADMIN_REQUIRE_MFA", "false") == "true",
		MetricsBearerToken: os.Getenv("METRICS_BEARER_TOKEN"),
		GuestTokenSecret:   os.Getenv("GUEST_TOKEN_SECRET"),
		GuestTokenTTL:      12 * time.Hour,
		ShutdownTimeout:    15 * time.Second,
		RedisURL:           os.Getenv("REDIS_URL"),
		InstanceID:         env("INSTANCE_ID", ""),
		YouTubeAPIKey:      os.Getenv("YOUTUBE_API_KEY"),
		YouTubeEnabled:     env("YOUTUBE_ENABLED", "true") == "true",
	}
	if cfg.DatabaseURL == "" || cfg.SupabaseURL == "" || cfg.GuestTokenSecret == "" {
		return Config{}, errors.New("DATABASE_URL, SUPABASE_URL and GUEST_TOKEN_SECRET are required")
	}
	if len(cfg.GuestTokenSecret) < 32 {
		return Config{}, errors.New("GUEST_TOKEN_SECRET must contain at least 32 characters")
	}
	if cfg.MetricsBearerToken != "" && len(cfg.MetricsBearerToken) < 32 {
		return Config{}, errors.New("METRICS_BEARER_TOKEN must contain at least 32 characters when configured")
	}
	for _, value := range splitCSV(os.Getenv("TRUSTED_PROXY_CIDRS")) {
		prefix, err := netip.ParsePrefix(value)
		if err != nil || prefix.Bits() == 0 || prefix.Addr().Is4In6() {
			return Config{}, errors.New("TRUSTED_PROXY_CIDRS must contain explicit IPv4 or IPv6 proxy CIDRs")
		}
		cfg.TrustedProxyCIDRs = append(cfg.TrustedProxyCIDRs, prefix.Masked())
	}
	for i, id := range cfg.AdminUserIDs {
		parsed, err := uuid.Parse(id)
		if err != nil {
			return Config{}, errors.New("ADMIN_USER_IDS must contain comma-separated Supabase user UUIDs")
		}
		cfg.AdminUserIDs[i] = parsed.String()
	}
	return cfg, nil
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
