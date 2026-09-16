# Architecture Overview — Mingly

## 1. System Vision & Architecture Philosophy

Mingly is designed as a **Modular Monolith** in Go. Rather than adopting distributed microservices prematurely, all business domains (Rooms, Permissions, Chat, Presence, Media Sync, Moderation, Token Issuance) live in a single Go binary with clear package boundaries.

Infrastructure services are strictly separated by responsibility:
- **Client (Frontend):** Next.js (React + TypeScript, managed with `pnpm`), Stage-first UI, Zustand state, LiveKit Client SDK, WebSocket protocol handler.
- **Go Monolith:** Authoritative domain engine, business logic, WebSocket connection hub, LiveKit token generator, room orchestrator.
- **Supabase (PostgreSQL + Auth):** Durable storage, user accounts, persistent room membership, and relational data.
- **Redis:** Low-latency ephemeral data (presence TTL heartbeats, cross-instance Pub/Sub, distributed rate limiting).
- **LiveKit Server (SFU):** Selective Forwarding Unit for WebRTC audio, video, and screen sharing tracks.

```
                      +-----------------------------+
                      |   Browser Client (React)    |
                      |  - Stage UI & Zustand Store |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               | (HTTP/REST)         | (App WS Protocol)   | (WebRTC Audio/Video)
               v                     v                     v
     +-----------------+   +------------------+   +------------------+
     |  Supabase Auth  |   |   Go Monolith    |   |   LiveKit SFU    |
     |   (JWT Issuance)|   | - chi Router     |   | - Audio Tracks   |
     +-----------------+   | - Room Actors    |   | - Video Tracks   |
                           | - Media Authority|   | - Screen Share   |
                           +--------+---------+   +------------------+
                                    |
            +-----------------------+-----------------------+
            | (SQL via pgxpool)                             | (Redis RESP)
            v                                               v
   +------------------+                            +------------------+
   | PostgreSQL (DB)  |                            |   Redis Cluster  |
   | - Users/Rooms    |                            | - Presence TTLs  |
   | - Chat History   |                            | - Ephemeral Sync |
   | - Audit / Bans   |                            | - Rate Limiters  |
   +------------------+                            +------------------+
```

---

## 2. Component Responsibility Matrix

| Component | Responsibility | NOT Responsible For |
| :--- | :--- | :--- |
| **Go Backend** | Canonical room state, synchronization logic, media queue mutations, room roles & authorization, LiveKit JWT creation, WebSocket protocol transport, slow-consumer backpressure. | Handling WebRTC media RTP packets; permanent auth user database hosting. |
| **LiveKit SFU** | Ingesting, transcoding, and distributing WebRTC audio, video, and screen-share streams; bandwidth estimation; track subscription. | Room permissions, chat messaging, media playback sync, room lifecycle. |
| **PostgreSQL** | Durable relational state: Users, Profiles, Rooms, Room Members, Chat Messages, Bans, Invites, Room Settings. | High-frequency presence heartbeats, sub-second media playback scrub updates. |
| **Redis** | Ephemeral distributed presence (keys expiring in 15s), Pub/Sub for inter-instance event fan-out, sliding-window rate limit counters. | Permanent message history, user identities, primary room record. |
| **React Frontend**| Rendering UI, local state (drawers, input fields, playback volume), client clock-offset calculation, triggering media player APIs. | Authoritative permission decisions, canonical playback timing, state reconciliation without server approval. |

---

## 3. Go Backend Package Layout

The backend follows an explicit modular layout without premature abstraction or circular dependencies:

```
backend/
├── cmd/
│   └── server/
│       └── main.go                 # Application entry point, dependency wiring, graceful shutdown
├── internal/
│   ├── platform/
│   │   ├── config/                 # Environment parsing and validation
│   │   ├── database/               # pgxpool connection management and migrations
│   │   ├── redis/                  # Redis client, distributed locking/rate-limiting helpers
│   │   ├── logger/                 # Structured slog wrapper with trace/request correlation
│   │   └── telemetry/              # Prometheus metric registrations and pprof hooks
│   ├── auth/                       # Supabase JWT parsing, public key caching, guest tokens
│   ├── users/                      # User profile queries and persistence
│   ├── rooms/                      # Canonical room lifecycle, membership, and memory actor
│   ├── permissions/                # Centralized authorization domain functions
│   ├── realtime/                   # WebSocket upgrade, client connection, hub, pump loops
│   ├── presence/                   # Ephemeral presence management and TTL heartbeats
│   ├── chat/                       # Realtime chat routing and batch database persistence
│   ├── media/                      # Canonical media state machine, provider abstractions, queue
│   ├── moderation/                 # Kick, ban, role mutation, and audit logging
│   └── livekit/                    # LiveKit token generator and room synchronization webhooks
└── migrations/                     # Sequential SQL migration files
```

---

## 4. Scaling Model: From Single Node to Multi-Instance

### Phase A: Single Node (Zero Cluster Complexity)
- In-memory `RoomManager` holding active rooms protected by granular sync primitives.
- In-memory channel hubs for WebSocket client fan-out.
- PostgreSQL for durability; optional local Redis for rate limiting.

### Phase B: Clustered Monolith (Horizontal Scaling)
- **Room Coordination:** Client connections connect to any Go backend node.
- **Cross-Instance Fan-out:** Nodes subscribe to Redis Pub/Sub channel `room:<room_id>:events`.
- **Node Affinity:** Optional sticky routing by `room_id` at the reverse proxy (e.g., NGINX/Envoy) to minimize cross-instance fan-out overhead.
- **Durable Authority:** Database remains the sole authority for persistent mutations.

---

## 5. Architectural Guardrails (Anti-Patterns Prohibited)

1. **NO Microservices:** Do not decompose Go into separate chat, presence, or media services. A single binary with domain packages is simpler, faster, and easier to reason about.
2. **NO WebRTC via WebSocket:** Video/audio frames must never touch the Go WebSocket connection. Media belongs exclusively in LiveKit SFU.
3. **NO Redis as Database:** If data must survive a Redis cache wipe, it must be written to PostgreSQL.
4. **NO Untyped Protocol Messages:** All WebSocket messages adhere to typed envelopes with explicit discriminators. No `map[string]interface{}` payload parsing.
5. **NO Mutex Contention with I/O:** Any handler holding a room lock must never initiate network calls, database queries, or Redis roundtrips while holding the lock.
