# Backend Architecture & Implementation Plan — Mingly

## 1. Backend Core Principles

The Mingly backend is implemented as an idiomatic, modular monolith in Go.
- **Language Level:** Go 1.22+ (using standard library packages `net/http`, `context`, `sync`, `slog`).
- **HTTP Routing:** `github.com/go-chi/chi/v5` for lightweight, idiomatic HTTP routing and middleware composition.
- **PostgreSQL Client:** `github.com/jackc/pgx/v5/pgxpool` for high-performance connection pooling and native binary protocol encoding.
- **Redis Client:** `github.com/redis/go-redis/v9` for connection management and Redis Pub/Sub streams.
- **WebRTC Integration:** `github.com/livekit/protocol` and `github.com/livekit/server-sdk-go/v2` for generating cryptographic media tokens and handling webhooks.
- **WebSocket Library:** `github.com/coder/websocket` (formerly `nhooyr.io/websocket`) or standard RFC-compliant gorilla for idiomatic context-driven WebSocket pump loops.

---

## 2. Directory Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go                 # Dependency injection, configuration load, OS signal listener
├── internal/
│   ├── platform/
│   │   ├── config/                 # Struct-based env parser with validation
│   │   ├── database/               # pgxpool factory, transaction runner
│   │   ├── redis/                  # Redis client factory with health checks
│   │   ├── logger/                 # slog setup with JSON handler and trace propagation
│   │   └── telemetry/              # Prometheus metric counters, histograms, pprof handler
│   ├── auth/                       # Supabase JWT parser, JWKS cache, guest token HMAC
│   │   ├── jwt.go
│   │   ├── guest.go
│   │   └── middleware.go
│   ├── rooms/                      # Canonical room lifecycle and in-memory actor
│   │   ├── model.go
│   │   ├── repository.go           # PostgreSQL CRUD
│   │   ├── service.go
│   │   └── state.go                # In-memory synchronized room state
│   ├── permissions/                # Centralized authorization domain
│   │   ├── roles.go
│   │   └── evaluator.go            # CanControlMedia, CanKick, CanShareScreen
│   ├── realtime/                   # WebSocket transport hub
│   │   ├── client.go               # Read/write pump, bounded buffers, ping/pong
│   │   ├── hub.go                  # Room routing and connection registration
│   │   ├── protocol.go             # Envelope and typed payload codecs
│   │   └── backpressure.go         # Slow consumer detection and drop policy
│   ├── presence/                   # Ephemeral presence tracker
│   │   ├── presence.go
│   │   └── redis_tracker.go        # Redis TTL keys and heartbeat runner
│   ├── media/                      # Synchronized media playback and queue
│   │   ├── controller.go           # Clock drift, play/pause/seek math
│   │   ├── queue.go                # Queue mutation logic and deduplication
│   │   └── provider.go             # YouTube, Spotify, SoundCloud capability interfaces
│   ├── chat/                       # Room messaging
│   │   ├── handler.go
│   │   └── batcher.go              # Async batch persistence to PostgreSQL
│   ├── moderation/                 # Kick, ban, host reassignment
│   │   └── service.go
│   └── livekit/                    # LiveKit token generator
│       └── token.go
├── migrations/                     # Sequential SQL migration files (.sql)
└── go.mod
```

---

## 3. Middleware Stack

The HTTP and WebSocket entrypoints pass through a strict chi middleware pipeline:

1. **`RequestID`**: Generates or propagates `X-Request-ID` into `context.Context`.
2. **`RealIP`**: Parses trusted reverse-proxy headers (`X-Forwarded-For`, `CF-Connecting-IP`).
3. **`StructuredLogger`**: Logs incoming requests with latency, status code, IP, and request ID via `slog`.
4. **`Recoverer`**: Traps panics, logs stack traces, and emits machine-readable `500 INTERNAL_SERVER_ERROR`.
5. **`CORS`**: Restricts allowed origins strictly to the configured frontend domain.
6. **`RateLimiter`**: Token bucket / sliding-window limit per IP or authenticated identity.
7. **`Authenticator`**: Validates Supabase JWT or guest bearer token; binds `UserContext` to request context.

---

## 4. Concurrency Model: The Room Actor Pattern

To prevent lock contention and race conditions, each active room operates with an explicit memory boundary:

```go
type RoomActor struct {
    mu             sync.RWMutex
    roomID         uuid.UUID
    version        uint64
    hostID         uuid.UUID
    members        map[uuid.UUID]*RoomMember
    mediaState     MediaPlaybackState
    queue          *MediaQueue
    connections    map[string]*ClientConnection // connection_id -> connection
    inboundEvents  chan RoomEvent
    closing        chan struct{}
}
```

### Mutex & I/O Rule
- State changes (version increments, member adds, queue reordering) occur under `mu.Lock()`.
- **Zero I/O Under Locks:** No SQL queries, Redis calls, HTTP requests, or WebSocket writes may be invoked while holding `mu`.
- Events to clients are pushed to non-blocking client write channels. If a client queue is full, the backpressure policy handles it outside the actor lock.

---

## 5. Graceful Shutdown Sequence

When the server receives `SIGINT` or `SIGTERM`:

1. **Stop Ingress:** Cease listening for new HTTP/WebSocket connections (`httpServer.Shutdown(ctx)` with 15s deadline).
2. **Notify Clients:** Broadcast `system.shutdown` event to all active WebSocket connections.
3. **Drain Sockets:** Close WebSocket connections with clean close code `1001 (Going Away)`.
4. **Flush Buffers:** Flush batched chat messages and audit logs to PostgreSQL.
5. **Release Ephemeral Keys:** Remove instance presence leases in Redis.
6. **Close Pools:** Close `pgxpool` and Redis connections safely.
7. **Exit:** Terminate process with exit code 0.
