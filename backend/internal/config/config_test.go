package config

import "testing"

func TestLoadRequiredConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/mingly")
	t.Setenv("SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("GUEST_TOKEN_SECRET", "01234567890123456789012345678901")
	t.Setenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.FrontendOrigins) != 2 {
		t.Fatalf("unexpected origins: %v", cfg.FrontendOrigins)
	}
	t.Setenv("METRICS_BEARER_TOKEN", "too-short")
	if _, err := Load(); err == nil {
		t.Fatal("short metrics bearer token accepted")
	}
	t.Setenv("METRICS_BEARER_TOKEN", "01234567890123456789012345678901")
	if cfg, err = Load(); err != nil || cfg.MetricsBearerToken == "" {
		t.Fatalf("valid metrics bearer token rejected: %v", err)
	}
	t.Setenv("GUEST_TOKEN_SECRET", "short")
	if _, err := Load(); err == nil {
		t.Fatal("short guest secret accepted")
	}
}
