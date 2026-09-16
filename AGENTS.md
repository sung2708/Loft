# AGENTS.md — Mingly Engineering Constitution

## Mission

Mingly is a production-oriented, realtime social hangout platform where friends congregate in shared digital rooms to hang out, talk via low-latency voice/video, share screens, chat, and synchronize media playback (YouTube) in real time.

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

## The 15 Non-Negotiable Engineering Invariants (MVP 2)

Before designing or writing code, every engineer and autonomous agent must enforce these 15 rules:

1. **Identify Source of Truth First**: Always determine the authoritative owner (Postgres, Go Memory, Redis, or LiveKit) before touching state logic.
2. **Zero Media via WebSocket**: Audio, video, and screen-share packets **never** enter the Go WebSocket connection.
3. **LiveKit Exclusively Handles Media**: LiveKit SFU manages all WebRTC audio/video/screen transport; the Go backend manages business authority and tokens.
4. **Video Effects Run Client-Side**: Face tracking and background segmentation execute in the browser via MediaPipe/WASM; never process video frames on Go backend servers.
5. **Mirroring Distinction**: Local front-camera self-preview is **mirrored**; published remote tracks and remote tiles are **unmirrored**. Screen share is **never mirrored**.
6. **Redis is Ephemeral Coordination Only**: Redis is an ephemeral bus for Pub/Sub, presence TTLs, and rate limits; **never** treat Redis as permanent durable storage.
7. **PostgreSQL Owns Durable Truth**: User profiles, room records, durable memberships, and message logs reside in PostgreSQL under ACID guarantees.
8. **Snapshot Recovery Over Event Replay**: Reconnecting clients fetch a fresh authoritative `room.snapshot`; never depend on historical event replay buffers.
9. **Zero Client Authority on Permissions**: Clients cannot declare roles or grant capabilities; every privileged action is validated server-side by domain evaluators.
10. **Slow Consumers Must Never Block Broadcasts**: Non-blocking enqueues only. Saturated client buffers (capacity 64) trigger immediate socket termination (`CloseNow`) to protect the room loop.
11. **No I/O Under Realtime Locks**: Database queries, Redis calls, LiveKit requests, and network socket writes are **strictly forbidden** inside mutex critical sections.
12. **No Unbounded Concurrency**: Every goroutine must have an explicit owner, a bounded lifetime, and context cancellation. All channels must have explicit capacities.
13. **Race Detector Mandatory**: Concurrency tests must pass with `go test -race ./...`. Pull requests introducing data races are release-blocking.
14. **Measure Before Optimizing**: Do not introduce premature complexity (e.g. WebGL shaders, CRDTs, or microservices) without profiled benchmark evidence.
15. **Effects Must Degrade Before Call Quality**: Enforce the golden rule: **Audio stability > Camera stability > Filter quality**. Video filters must step down or disable before impacting call audio or framerate.

---

## Source of Truth Rule

| State Domain | Source of Truth | Secondary / Ephemeral Layers |
| :--- | :--- | :--- |
| **User Identity & Auth** | Supabase Auth (JWT) & Go HMAC | Go backend token verification cache |
| **Durable Room & Membership** | PostgreSQL | Go in-memory room cache |
| **Permissions & Moderation Rules** | PostgreSQL | Evaluated in-memory in Go domain layer |
| **Active Room State (Version, Host)** | Go Room Authority / Mutex | Redis (coordination/leases if clustered) |
| **Realtime Presence & Heartbeats** | Redis (TTL leases) | Go in-memory presence subscriber map |
| **Media Playback & Queue State** | Go Room Authority | Synchronized to clients via `media.state`; history in Postgres |
| **WebRTC Media Transport & Tracks** | LiveKit SFU | Go room manager coordinates token issuance |
| **Ephemeral Chat / Reactions** | Realtime WebSocket broadcast | Messages persisted to Postgres synchronously |
| **UI State (Drawers, Volume, Theme)** | Client Zustand store | Never authoritative for security or room state |

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

## UI/UX Copywriting & Anti-AI Slop Rules

1. **App UI vs. Landing Page (Functional Utility):** All in-app copy must be strictly functional, intuitive, and task-driven (like Discord, Google Meet, Zoom). Prohibit marketing slogans, promotional phrasing, or landing page pitches (forbidden: "Trò chuyện tức thì", "Sẵn sàng khi bạn muốn", "Đồng bộ chất lượng cao").
2. **Action Labels (Buttons & Actions):** Exactly 1 decisive verb, 1–3 words maximum (e.g., "Tham gia", "Sao chép", "Đăng nhập", "Rời phòng"). Never attach emotional adjectives or promotional badges ("TỨC THÌ", "CỰC NHANH").
3. **Conceal Backend/Architecture:** Never expose internal tech stack or protocol names (LiveKit, WebRTC, WebSocket, Socket.IO, API status) on user-facing interfaces. Connection states are represented by intuitive visual icons or minimal functional labels.
4. **Titles & Descriptions:** Preserve user-defined entity names verbatim. Never auto-generate feature explanation subheadings beneath titles (e.g., "Trò chuyện video, chia sẻ màn hình..."). Use live contextual metadata (participant count, host) or leave blank. Never generate footer feature cards.
5. **UI Code Generation Principle:** When generating or refactoring UI components, automatically scan and purge AI-slop filler, promotional copy, and marketing verbiage without requiring reminder.

---

## Documentation Roadmap Index

For detailed architectural specifications, reference the operational documentation in `docs/`:

- [MVP 2 Scope & Boundaries](file:///d:/git/Loft/docs/mvp2-scope.md)
- [Implementation Roadmap (MVP 2 Execution)](file:///d:/git/Loft/docs/roadmap.md)
- [Client-Side Media Processing](file:///d:/git/Loft/docs/media-processing.md)
- [Video Effects Architecture](file:///d:/git/Loft/docs/video-effects.md)
- [LiveKit WebRTC Integration & Optimization](file:///d:/git/Loft/docs/livekit.md)
- [Realtime Protocol](file:///d:/git/Loft/docs/realtime-protocol.md)
- [Room State Management](file:///d:/git/Loft/docs/room-state.md)
- [Media Synchronization Engine](file:///d:/git/Loft/docs/media-sync.md)
- [Collaborative Media Queue](file:///d:/git/Loft/docs/media-queue.md)
- [Reconnect & Snapshot Recovery](file:///d:/git/Loft/docs/reconnect-recovery.md)
- [Redis Ephemeral Storage & Pub/Sub](file:///d:/git/Loft/docs/redis.md)
- [Multi-Instance Realtime Architecture](file:///d:/git/Loft/docs/multi-instance-realtime.md)
- [Concurrency, Thread Safety & Backpressure](file:///d:/git/Loft/docs/concurrency.md)
- [Authentication & Permissions](file:///d:/git/Loft/docs/auth-and-permissions.md)
- [Observability, Logs & Metrics](file:///d:/git/Loft/docs/observability.md)
- [Failure Modes & Graceful Degradation](file:///d:/git/Loft/docs/failure-modes.md)
- [Load Testing & Benchmarks](file:///d:/git/Loft/docs/load-testing.md)
- [Testing Strategy & Quality Assurance](file:///d:/git/Loft/docs/testing-strategy.md)
- [Architecture Decision Records (ADR)](file:///d:/git/Loft/docs/adr/README.md)
