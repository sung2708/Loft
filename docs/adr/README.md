# Architecture Decision Records (ADRs) — Loft

This directory records all critical architectural decisions for Loft. Each record documents the context, decision, alternatives evaluated, and engineering consequences.

---

## Index of Architectural Decisions

- [ADR-001: Modular Monolith in Go](#adr-001-modular-monolith-in-go)
- [ADR-002: LiveKit as Dedicated WebRTC SFU Infrastructure](#adr-002-livekit-as-dedicated-webrtc-sfu-infrastructure)
- [ADR-003: Supabase (PostgreSQL + Auth) for Identity & Durability](#adr-003-supabase-postgresql--auth-for-identity--durability)
- [ADR-004: Redis for Ephemeral State and Inter-Node Fan-Out](#adr-004-redis-for-ephemeral-state-and-inter-node-fan-out)
- [ADR-005: Snapshot Recovery Over Event Sourcing / Replay Buffers](#adr-005-snapshot-recovery-over-event-sourcing--replay-buffers)
- [ADR-006: Dedicated WebSocket Protocol for Control Plane](#adr-006-dedicated-websocket-protocol-for-control-plane)

---

### ADR-001: Modular Monolith in Go

- **Status:** Accepted
- **Context:** Realtime systems require high concurrency, low latency, predictable garbage collection, and bounded memory consumption. We need a backend architecture that is fast, maintainable by a single engineer, and scalable without microservice operational overhead.
- **Decision:** Build the backend as a **Modular Monolith in Go**, using standard library idioms and `chi` for routing.
- **Alternatives Considered:**
  - *Node.js / TypeScript:* Single-threaded event loop can suffer CPU starvation during high-frequency cryptographic operations or large array transformations; type safety is erased at runtime.
  - *Rust:* High development friction and borrow-checker complexity for rapid iteration, without substantial benefit over Go's sub-millisecond GC pauses.
  - *Microservices:* Premature operational complexity (distributed tracing, separate CI/CD, multiple deployables).
- **Consequences:**
  - High throughput and minimal memory footprint per connection.
  - Clear package boundaries prevent circular dependencies.
  - Easy horizontal scaling via Docker containers.

---

### ADR-002: LiveKit as Dedicated WebRTC SFU Infrastructure

- **Status:** Accepted
- **Context:** Transporting audio, video, and screen-sharing tracks directly through the application server would create massive CPU and network contention, degrading business logic.
- **Decision:** Deploy **LiveKit** as a standalone Selective Forwarding Unit (SFU). The Go backend manages token generation, permissions, and webhook tracking; LiveKit handles WebRTC renegotiation, simulcast, and RTP forwarding.
- **Alternatives Considered:**
  - *Building a custom Pion WebRTC SFU:* Massive engineering time sink; reinvents congestion control, simulcast, and ICE negotiation.
  - *Full Mesh P2P WebRTC:* Unusable for rooms with more than 3–4 participants due to client upload bandwidth exhaustion ($O(N^2)$ streams).
- **Consequences:**
  - WebRTC media is strictly isolated from application logic.
  - Application WebSocket is never burdened with video/audio frames.

---

### ADR-003: Supabase (PostgreSQL + Auth) for Identity & Durability

- **Status:** Accepted
- **Context:** We need enterprise-grade authentication (OAuth, email login, session management) and durable relational storage without managing identity cryptography from scratch.
- **Decision:** Use **Supabase** for user authentication and managed PostgreSQL. The Go backend connects directly to PostgreSQL via `pgxpool` and validates Supabase JWTs.
- **Alternatives Considered:**
  - *Custom Auth in Go:* High security liability; high maintenance burden for password resets, email verification, and OAuth integrations.
  - *MongoDB / Document DB:* Weak multi-table relational integrity for membership, room ownership, and bans.
- **Consequences:**
  - Reliable identity infrastructure out of the box.
  - Direct PostgreSQL access allows fast, parameterized queries and atomic transactions.

---

### ADR-004: Redis for Ephemeral State and Inter-Node Fan-Out

- **Status:** Accepted
- **Context:** Realtime presence heartbeats, sliding-window rate limits, and cross-node broadcasting require sub-millisecond performance and automatic expiration.
- **Decision:** Use **Redis** strictly for ephemeral coordination: keys with TTLs for presence and Pub/Sub for multi-instance broadcast fan-out. Redis is never used as durable storage.
- **Alternatives Considered:**
  - *Kafka / RabbitMQ:* Excessive operational complexity for non-durable realtime fan-out.
  - *PostgreSQL NOTIFY:* Inefficient at high message frequencies; risks database connection pool saturation.
- **Consequences:**
  - If Redis restarts, only temporary presence is disrupted; no permanent data is lost.
  - Single-node deployments can operate with in-memory fallbacks when Redis is omitted.

---

### ADR-005: Snapshot Recovery Over Event Sourcing / Replay Buffers

- **Status:** Accepted
- **Context:** Clients experience network interruptions (switching WiFi, backgrounding browser). The system must reliably resynchronize clients without unbounded memory growth.
- **Decision:** Use **Authoritative Snapshot Recovery** (`room.snapshot`). Reconnecting clients fetch the latest versioned room state rather than replaying historical event streams.
- **Alternatives Considered:**
  - *Event Sourcing / CQRS:* Massive schema and storage complexity; requires storing every ephemeral seek and pause forever.
  - *Sliding Event Replay Buffers:* Unbounded memory risk under slow consumer scenarios; complex gap reconciliation.
- **Consequences:**
  - Simple $O(1)$ memory requirement per active room.
  - Deterministic client state replacement eliminating out-of-order reconciliation bugs.

---

### ADR-006: Dedicated WebSocket Protocol for Control Plane

- **Status:** Accepted
- **Context:** Control commands (media sync, chat, presence, moderation) need low-latency bidirectional transport. We evaluated WebRTC Data Channels vs. a dedicated WebSocket.
- **Decision:** Use a **Dedicated WebSocket Protocol** (`wss://`) for the application control plane, reserving WebRTC solely for media tracks in LiveKit.
- **Alternatives Considered:**
  - *WebRTC Data Channels for App Events:* Complex peer setup; couples application messaging to the WebRTC connection state; hard to inspect and debug.
- **Consequences:**
  - Application features (chat, shared media, room management) remain 100% operational even if LiveKit media connectivity fails.
