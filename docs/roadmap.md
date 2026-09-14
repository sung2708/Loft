# Implementation Roadmap (16-Phase Plan) — Loft

## Overview

The Loft implementation follows a progressive, iterative roadmap. Each phase delivers a working, verifiable layer of functionality without premature complexity.

---

### Phase 0 — Engineering Foundation
- **Deliverables:** Directory layout, environment config validation (`platform/config`), structured logger (`slog`), database pool (`pgxpool`), sequential migration engine, Docker Compose local dev stack, health/readiness endpoints (`/healthz`, `/readyz`).
- **Success Criteria:** Backend boots locally, executes migrations cleanly, and passes health checks.

### Phase 1 — Identity & Authentication
- **Deliverables:** Supabase JWT parser with in-memory JWKS cache, guest identity generator (HMAC-SHA256), `UserContext` HTTP middleware, profile persistence in PostgreSQL.
- **Success Criteria:** Verified tokens extract `user_id` correctly; guest tokens are validated and rejected if expired or mismatched by room.

### Phase 2 — Room Authority & Membership
- **Deliverables:** Room creation API, membership table, role model (`host`, `moderator`, `member`, `guest`), centralized permission evaluator (`CanChangeSettings`, `CanKick`, etc.), in-memory `RoomActor` skeleton.
- **Success Criteria:** Room state holds canonical `host_id`; permission evaluator passes exhaustive unit tests.

### Phase 3 — WebSocket Realtime Protocol
- **Deliverables:** WebSocket upgrade handler with origin verification, read/write pump loops with bounded channels (`256`), ping/pong heartbeats, typed JSON protocol envelopes, `room.join` and `room.snapshot` delivery.
- **Success Criteria:** Clients receive authoritative snapshot upon joining; malformed or oversized payloads (>64KB) return typed error without crashing the server.

### Phase 4 — Ephemeral Presence & Heartbeats
- **Deliverables:** In-memory presence tracker, client heartbeat pings (every 10s), multi-connection aggregation (multiple tabs per user), presence diff broadcasts (`participant.joined`, `participant.left`).
- **Success Criteria:** Closing one tab while another remains open does not drop the user's presence in the room.

### Phase 5 — Room Chat & History Archive
- **Deliverables:** Realtime chat routing via WebSocket, sliding-window rate limiting (5 msgs/3s), asynchronous database persistence batcher (`ChatBatcher`), cursor-paginated chat history REST endpoint.
- **Success Criteria:** High-frequency chat bursts do not stall room broadcasts; all chat messages persist to PostgreSQL within 2 seconds.

### Phase 6 — LiveKit SFU Integration
- **Deliverables:** LiveKit client SDK integration in Go, cryptographic token issuance endpoint (`GET /rooms/{id}/livekit-token`), room-to-LiveKit room mapping, React CallDock with mic/camera controls and active speaker highlighting.
- **Success Criteria:** Low-latency voice and video streaming between participants; tokens expire in 2 hours and enforce room boundaries.

### Phase 7 — Screen Sharing Experience
- **Deliverables:** Browser screen/window/tab capture (`getDisplayMedia`), LiveKit screen track publishing, `screen.started`/`screen.stopped` application signaling, dynamic Stage layout switching to prioritize screen share view.
- **Success Criteria:** Screen share track displays at high framerate on the Stage; stopping share resets stage to video grid.

### Phase 8 — Synchronized Media Engine (YouTube First)
- **Deliverables:** YouTube IFrame API adapter, Go canonical playback calculation `base_pos + (now - started_at)`, NTP clock offset calibration, three-tier drift correction engine (<250ms, 250–1000ms, >1000ms), stale command rejection.
- **Success Criteria:** Multiple connected clients stay synchronized within 250ms of each other during play, pause, and seek actions.

### Phase 9 — Shared Media Queue
- **Deliverables:** Queue mutation protocol (`queue.add`, `queue.remove`, `queue.reorder`), server-side URL validation & regex ID extraction, idempotency keys to prevent double-adds, automatic track progression on finish.
- **Success Criteria:** Concurrent queue additions resolve deterministically; non-permitted users cannot delete other members' submissions.

### Phase 10 — Reconnect Recovery & Host Failover
- **Deliverables:** Client reconnect finite state machine (`RECONNECTING` -> `RESYNCING`), exponential backoff with jitter, versioned snapshot recovery, host failover grace period (15s), deterministic successor election.
- **Success Criteria:** Disconnecting and reconnecting recovers room and media state in <1 second without manual refresh; killing host browser reassigns host role cleanly after 15s.

### Phase 11 — Redis Ephemeral Clustering
- **Deliverables:** Redis Pub/Sub room event fan-out, Redis TTL presence tracking (15s TTL), distributed sliding-window rate limiters, fallback to in-memory mode when Redis is absent.
- **Success Criteria:** Two separate Go instances forward chat and playback events to each other's clients seamlessly.

### Phase 12 — Multi-Provider Media (Spotify & SoundCloud)
- **Deliverables:** Spotify Web Playback SDK integration, SoundCloud Widget adapter, provider capability enforcement matrix (skipping soft drift correction on unadjustable players).
- **Success Criteria:** Room can switch seamlessly between YouTube, Spotify, and SoundCloud without crashing playback state.

### Phase 13 — Moderation & Room Governance
- **Deliverables:** Moderation APIs (`moderation.kick`, `moderation.ban`), host transfer workflow, moderator assignment, token revocation, audit log table in PostgreSQL.
- **Success Criteria:** Banned user's WebSocket is immediately closed, LiveKit token revoked, and re-entry attempts rejected.

### Phase 14 — Observability & Telemetry
- **Deliverables:** Prometheus metrics exporter (`/metrics`), structured log correlation IDs (`request_id`, `connection_id`, `room_id`), pprof profiling endpoints on internal port, Grafana dashboard configuration.
- **Success Criteria:** System metrics expose connection count, latency histograms, and dropped slow client counters without high-cardinality label leakage.

### Phase 15 — Performance Tuning & Load Testing
- **Deliverables:** k6 / Go load testing harness, progressive benchmarks (Profiles A, B, C, D), reconnect storm tests, slow-consumer isolation validation, pprof memory and goroutine leak audits.
- **Success Criteria:** System sustains Profile C (500 concurrent connections) with $P_{95}$ broadcast latency $< 50\text{ms}$ and zero goroutine leaks.

### Phase 16 — Production Hardening & Security Audit
- **Deliverables:** Security threat model verification, dependency vulnerability scans (`govulncheck`, `pnpm audit`), SSRF IP blocklist validation, rate limit tuning, graceful deployment verification.
- **Success Criteria:** Clean vulnerability scan, zero secrets in repo, robust operational runbook ready.
