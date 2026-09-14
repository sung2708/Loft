package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	Address           string
	DatabaseURL       string
	SupabaseURL       string
	SupabaseJWTSecret string
	SupabaseAudience  string
	LiveKitURL        string
	LiveKitAPIKey     string
	LiveKitAPISecret  string
	FrontendOrigins   []string
	GuestTokenSecret  string
	GuestTokenTTL     time.Duration
	ShutdownTimeout   time.Duration
	RedisURL          string
	InstanceID        string
}

func Load() (Config, error) {
	cfg := Config{
		Address:           env("HTTP_ADDR", ":8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		SupabaseURL:       strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseJWTSecret: os.Getenv("SUPABASE_JWT_SECRET"),
		SupabaseAudience:  env("SUPABASE_JWT_AUDIENCE", "authenticated"),
		LiveKitURL:        os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:     os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:  os.Getenv("LIVEKIT_API_SECRET"),
		FrontendOrigins:   splitCSV(env("FRONTEND_ORIGINS", "http://localhost:3000")),
		GuestTokenSecret:  os.Getenv("GUEST_TOKEN_SECRET"),
		GuestTokenTTL:     12 * time.Hour,
		ShutdownTimeout:   15 * time.Second,
		RedisURL:          os.Getenv("REDIS_URL"),
		InstanceID:        env("INSTANCE_ID", ""),
	}
	if cfg.DatabaseURL == "" || cfg.SupabaseURL == "" || cfg.GuestTokenSecret == "" {
		return Config{}, errors.New("DATABASE_URL, SUPABASE_URL and GUEST_TOKEN_SECRET are required")
	}
	if len(cfg.GuestTokenSecret) < 32 {
		return Config{}, errors.New("GUEST_TOKEN_SECRET must contain at least 32 characters")
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
