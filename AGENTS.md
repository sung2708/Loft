# AGENTS.md — Loft Engineering Constitution

## Mission

Loft is a production-oriented, realtime social hangout platform where friends congregate in shared digital rooms to hang out, talk via low-latency voice/video, share screens, chat, and synchronize media playback (YouTube, Spotify, SoundCloud) in real time.

The engineering goal is to maintain a robust, race-free, bounded-concurrency architecture that is resilient to network drops, node failover, and high concurrency while remaining maintainable by a single developer.

---

## Engineering Priorities (Strict Order)

Every technical decision, pull request, and refactoring must prioritize in this exact order:

1. **Correctness** — Race-safe state transitions, sound state machines, deterministic logic.
2. **Security** — Zero-trust client boundary, centralized authorization, SSRF & origin validation.
3. **Data Integrity** — PostgreSQL as durable source of truth; transactional boundaries respected.
4. **Realtime Reliability** — Bounded channels, slow-consumer protection, snapshot-based reconnect recovery.
5. **Maintainability** — Modular monolith, idiomatic Go, typed protocol, readable abstractions.
6. **Observability** — Structured logs, contextual correlation IDs, domain metrics without high-cardinality labels.
7. **Performance** — Bounded memory, non-blocking broadcasts, efficient data structures (measure before tuning).
8. **Developer Experience** — Deterministic local Docker environment, clear test fixtures, minimal magic.
9. **Visual Polish** — Stage-first layout, media-centric atmosphere, responsive micro-interactions.

---

## Source of Truth Rule

Before inspecting or writing code, **identify the authoritative source of truth** for the state:

| State Domain | Source of Truth | Secondary / Ephemeral Layers |
| :--- | :--- | :--- |
| **User Identity & Auth** | Supabase Auth (JWT) | Go backend token verification cache |
| **Durable Room & Membership** | PostgreSQL | Go in-memory room cache |
| **Permissions & Moderation Rules** | PostgreSQL | Evaluated in-memory in Go domain layer |
| **Active Room State (Version, Host)** | Go Room Actor / State Mutex | Redis (coordination/leases if clustered) |
| **Realtime Presence & Heartbeats** | Redis (TTL leases) | Go in-memory presence subscriber map |
| **Media Playback & Queue State** | Go Room Authority | Synchronized to clients; history in Postgres |
| **WebRTC Media Transport & Tracks** | LiveKit SFU | Go room manager coordinates token issuance |
| **Ephemeral Chat / Reactions** | Realtime WebSocket broadcast | Messages persisted to Postgres asynchronously |
| **UI State (Drawers, Volume, Theme)** | Client Zustand store | Never authoritative for security or room state |

> **Rule:** Never fix a synchronization bug without first determining authoritative ownership. Never use Redis as accidental permanent storage.

---

## Architectural Boundaries

- **Supabase owns:** Auth infrastructure, PostgreSQL hosting, durable storage, database migrations.
- **Go Modular Monolith owns:** Business authority, room lifecycle, membership state, permissions, canonical room & media state, WebSocket protocol, backpressure management, LiveKit token issuance, host failover.
- **Redis owns:** Ephemeral distributed state only (presence TTLs, cross-instance Pub/Sub, distributed rate limits, short-lived cache).
- **LiveKit owns:** WebRTC media transport (audio, video, screen sharing, SFU routing). The Go WebSocket layer **never** routes media packet payloads.
- **Next.js (React + TypeScript) owns:** Rendering, local UI state, optimistic UX where safe, WebSocket and LiveKit client lifecycle. The frontend is **never** authoritative for security or permissions.

---

## Repository Discipline

1. **Inspect Before Changing:** Read nearby code, understand existing conventions, and preserve invariants.
2. **No Parallel Implementations:** Extend existing patterns rather than creating duplicate abstractions or competing frameworks.
3. **Zero Unbounded Concurrency:** Every goroutine must have an explicit owner, bounded lifetime, and context cancellation.
4. **No I/O Under Locks:** Never perform network I/O, database queries, Redis calls, or LiveKit requests while holding room or state mutexes.
5. **Typed Protocol Only:** Avoid `map[string]interface{}` or `any` blobs. Use strongly typed Go structs and TypeScript discriminated unions.
6. **Snapshot Recovery Over Replay:** Network interruptions recover via authoritative versioned state snapshots, not unbounded event replay logs.
7. **Race Detector Mandatory:** All concurrency-sensitive backend tests must pass with `go test -race ./...`.
8. **Centralized Authorization:** Authorization checks must call domain functions (e.g., `CanControlMedia(actor, room)`), never ad-hoc `if role == "host"` scattered in transport handlers.

---

## Change Planning Requirement

For every non-trivial change, formulate a concise technical plan addressing:
- Files/modules affected
- Current behavior vs. Desired behavior
- Authoritative source of truth
- Protocol & API impact
- Concurrency & lock scope analysis
- Failure modes & recovery behavior
- Security impact (auth, validation, SSRF, rate limits)
- Test plan (`-race`, unit, integration)
- Observability impact (logs, metrics)

---

## Documentation Roadmap Index

For detailed architectural specifications, reference the operational documentation in `docs/`:

- [Architecture Overview](file:///d:/git/Loft/docs/architecture.md)
- [System Boundaries](file:///d:/git/Loft/docs/system-boundaries.md)
- [Realtime Protocol](file:///d:/git/Loft/docs/realtime-protocol.md)
- [Realtime Architecture & WebSocket](file:///d:/git/Loft/docs/realtime-architecture.md)
- [Room State Management](file:///d:/git/Loft/docs/room-state.md)
- [Media Synchronization Engine](file:///d:/git/Loft/docs/media-sync.md)
- [Presence & Ephemeral State](file:///d:/git/Loft/docs/presence.md)
- [Reconnect & Snapshot Recovery](file:///d:/git/Loft/docs/reconnect-recovery.md)
- [Authentication & Permissions](file:///d:/git/Loft/docs/auth-and-permissions.md)
- [Database Schema & Persistence](file:///d:/git/Loft/docs/database.md)
- [Redis Ephemeral Storage & Pub/Sub](file:///d:/git/Loft/docs/redis.md)
- [LiveKit WebRTC Integration](file:///d:/git/Loft/docs/livekit.md)
- [Concurrency & Thread Safety](file:///d:/git/Loft/docs/concurrency.md)
- [Failure Modes & Graceful Degradation](file:///d:/git/Loft/docs/failure-modes.md)
- [Security & Threat Model](file:///d:/git/Loft/docs/security.md)
- [Observability, Logs & Metrics](file:///d:/git/Loft/docs/observability.md)
- [Load Testing & Benchmarks](file:///d:/git/Loft/docs/load-testing.md)
- [Testing Strategy](file:///d:/git/Loft/docs/testing-strategy.md)
- [Deployment & Environment](file:///d:/git/Loft/docs/deployment.md)
- [Implementation Roadmap](file:///d:/git/Loft/docs/roadmap.md)
- [Architecture Decision Records (ADR)](file:///d:/git/Loft/docs/adr/README.md)
