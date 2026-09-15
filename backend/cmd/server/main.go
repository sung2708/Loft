package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"

	"loft/backend/internal/auth"
	"loft/backend/internal/config"
	"loft/backend/internal/httpapi"
	"loft/backend/internal/livekit"
	"loft/backend/internal/realtime"
	"loft/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := godotenv.Load(".env"); err != nil && !os.IsNotExist(err) {
		logger.Error("invalid .env file")
		os.Exit(1)
	}
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	if cfg.InstanceID == "" {
		cfg.InstanceID = uuid.NewString()
	}
	logger = logger.With("instance_id", cfg.InstanceID)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	database, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	defer database.Close()
	users := auth.NewSupabaseVerifier(cfg.SupabaseURL, cfg.SupabaseAudience, cfg.SupabaseJWTSecret)
	guests := auth.NewGuestTokens(cfg.GuestTokenSecret, cfg.GuestTokenTTL)
	liveKitService := livekit.New(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	if err := liveKitService.SetURL(cfg.LiveKitURL); err != nil {
		logger.Error("invalid LiveKit URL", "error", err)
		os.Exit(1)
	}
	hub := realtime.New(database, guests, users, cfg.FrontendOrigins, logger)
	hub.SetParticipantEvictor(liveKitService)
	api := httpapi.New(database, users, guests, liveKitService, cfg.FrontendOrigins, logger, hub)
	if cfg.RedisURL != "" {
		bus, err := realtime.NewRedisBus(cfg.RedisURL, cfg.InstanceID, logger)
		if err != nil {
			logger.Error("redis disabled; serving local realtime only", "error", err)
		} else {
			hub.SetBus(bus)
			hub.ConfigureDistributedRateLimits(bus)
			api.ConfigureDistributedRateLimits(bus)
			bus.Start(ctx, hub.DeliverRemote)
			defer bus.Close()
		}
	}
	server := &http.Server{Addr: cfg.Address, Handler: api.Routes(hub), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		logger.Info("Loft API listening", "address", cfg.Address)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := hub.Shutdown(shutdownCtx); err != nil {
		logger.Error("websocket shutdown failed", "error", err)
	}
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
