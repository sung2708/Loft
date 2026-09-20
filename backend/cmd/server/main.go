package main

import (
	"context"
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
	"loft/backend/internal/observability"
	"loft/backend/internal/realtime"
	"loft/backend/internal/store"
)

func main() {
	if err := godotenv.Load(".env"); err != nil && !os.IsNotExist(err) {
		bootstrapLogger := observability.NewLogger("production", os.Stderr)
		bootstrapLogger.Error().Err(err).Msg("invalid .env file")
		os.Exit(1)
	}
	logger := observability.NewLogger(os.Getenv("APP_ENV"), os.Stdout)
	cfg, err := config.Load()
	if err != nil {
		logger.Error().Err(err).Msg("invalid configuration")
		os.Exit(1)
	}
	if cfg.InstanceID == "" {
		cfg.InstanceID = uuid.NewString()
	}
	logger = logger.With().Str("instance_id", cfg.InstanceID).Logger()
	slogLogger := observability.SlogLogger(logger)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	database, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error().Err(err).Msg("database initialization failed")
		os.Exit(1)
	}
	defer database.Close()
	users := auth.NewSupabaseVerifier(cfg.SupabaseURL, cfg.SupabaseAudience, cfg.SupabaseJWTSecret)
	guests := auth.NewGuestTokens(cfg.GuestTokenSecret, cfg.GuestTokenTTL)
	liveKitService := livekit.New(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	if err := liveKitService.SetURL(cfg.LiveKitURL); err != nil {
		logger.Error().Err(err).Msg("invalid LiveKit URL")
		os.Exit(1)
	}
	hub := realtime.New(database, guests, users, cfg.FrontendOrigins, slogLogger)
	hub.SetParticipantEvictor(liveKitService)
	api := httpapi.New(database, users, guests, liveKitService, cfg.FrontendOrigins, slogLogger, hub)
	api.ConfigureObservability(logger, observability.NewMetrics())
	if cfg.RedisURL != "" {
		bus, err := realtime.NewRedisBus(cfg.RedisURL, cfg.InstanceID, slogLogger)
		if err != nil {
			logger.Error().Err(err).Msg("redis disabled; serving local realtime only")
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
		logger.Info().Str("address", cfg.Address).Msg("Mingly API listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error().Err(err).Msg("server failed")
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := hub.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("websocket shutdown failed")
	}
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("graceful shutdown failed")
	}
}
