# Loft MVP 2 — Scope & Architecture Boundaries

This document establishes the authoritative engineering boundaries for **Loft MVP 2**. Every technical decision, PR, and refactoring within MVP 2 must strictly adhere to these boundaries. Features outside the explicit in-scope list are deferred.

---

## 1. Executive Summary & Evolution

Loft MVP 1 successfully established a working, single-node social room with low-latency WebRTC voice/video (LiveKit), a dedicated WebSocket control plane, Supabase authentication, durable PostgreSQL storage, and synchronized YouTube playback for small groups.

**MVP 2 evolves Loft into:**
1. A **visually polished social video experience** with camera mirror correctness and optimized raw camera capture. Face filters and background effects move to MVP 3.
2. An **optimized WebRTC experience** utilizing LiveKit adaptive streaming, dynacast, and viewport-aware subscription quality.
3. A **multi-instance-capable backend** backed by Redis Pub/Sub for realtime room fan-out and ephemeral presence coordination without compromising PostgreSQL data durability.
4. A **hardened realtime protocol** featuring bounded outbound backpressure, slow consumer protection, robust reconnect state recovery, and optimistic versioning.
5. A **collaborative shared media experience** with deterministic YouTube timeline synchronization, drift correction, and an interactive queue.
6. A **rigorously observable and load-tested system** with structured contextual logging, clean domain metrics, and resilience against network, node, and hardware failure modes.

---

## 2. In Scope for MVP 2

The following items are strictly **IN SCOPE** for MVP 2:

### A. Video & Camera Correctness
- **Camera Mirroring Fix**: Deterministic separation between local self-preview mirroring (natural mirror UX) and published video track orientation (unmirrored for remote peers).
- **Facing Mode Behavior**: Automatic detection of `user` (front) vs `environment` (rear) camera facing modes.
- **Screen-Share Invariance**: Strict prohibition of mirroring on screen-share tracks.

### B. Client-Side Video Effects — Deferred to MVP 3
MediaPipe processing, background effects and face filters are deliberately deferred. MVP 2 retains camera orientation correctness and keeps the raw camera path optimized.

### C. LiveKit / WebRTC Media Optimization
- **Adaptive Streaming**: Dynamic layer switching according to participant viewport sizes.
- **Dynacast & Simulcast**: SFU pausing of unneeded video layers when off-screen or minimized.
- **Subscription Quality**: Tile-size-aware track subscriptions (low bitrate for small participant tiles, full bitrate for solo/active screen share).
- **Screen Share Optimization**: Track configuration with `contentHint: "detail"` for high-fidelity text and low motion latency.
- **Connection Quality Indication**: Visual network health badges based on LiveKit connection metrics.

### D. Realtime Hardening & Backpressure
- **Bounded Outbound Queues**: Strict channel capacity (`outboundCapacity = 64`) on WebSocket connections.
- **Slow Consumer Isolation**: Non-blocking room broadcast loops with immediate termination (`conn.CloseNow()`) of saturated client sockets to prevent head-of-line blocking.
- **Payload Sanitization**: Maximum frame size caps (16KB) and strict input validation.
- **Snapshot Resync on Reconnect**: Authoritative `room.snapshot` delivery after network interruptions (`DISCONNECTED` → `CONNECTING` → `RECONNECTING` → `RESYNCING` → `CONNECTED`).

### E. Redis & Multi-Instance Realtime
- **Cross-Instance Fan-Out**: Redis Pub/Sub room event bus (`room:<id>:events`) interconnecting multiple Go monolithic instances.
- **Origin Instance Guard**: Inclusion of `origin_instance_id` to prevent recursive re-broadcast loops.
- **Ephemeral Presence Leases**: Redis key TTLs (15s) refreshed by client heartbeats.
- **Distributed Rate Limiting**: Sliding-window rate limit counters in Redis with graceful in-memory fallbacks.
- **Degraded Operation**: Seamless fallback to single-node in-memory operation when `REDIS_URL` is omitted or Redis is unreachable.

### F. Synchronized Media & Collaborative Queue
- **Server-Authoritative YouTube State**: Dynamic playback position prediction based on anchor timestamps ($P = P_0 + (t - t_0) \times \text{rate}$); zero continuous timestamp broadcasting.
- **Client Playback via Official Embed**: Native playback in YouTube IFrame API; zero backend media proxying or restreaming.
- **Three-Tier Drift Correction**: Passive tolerance ($<250\text{ms}$), soft playback rate nudges ($250\text{ms}–1500\text{ms}$), and hard seek resync ($>1500\text{ms}$).
- **Collaborative Queue Engine**: Stable UUID item identities, optimistic concurrency guard (`expected_version`), queue reordering, track skipping, and host clear actions.

### G. Room Authority & Permissions
- **Centralized Evaluation**: Server-side permission guards (`CanChangeSettings`, `CanKick`, `CanControlMedia`, `CanManageQueue`).
- **Basic Host Governance**: Room locking (`room.lock`), guest admission policies, and participant eviction (`participant.kick`).
- **Host Disconnect Handling**: Graceful grace period before state eviction or host reassignment.

### H. Observability, Failure Testing & Load Testing
- **Structured JSON Logging**: Standard library `log/slog` with mandatory correlation fields (`request_id`, `room_id`, `participant_id`, `connection_id`, `instance_id`, `event_type`).
- **Zero Credential Leaks**: Strict token and secret redaction from all loggers and error responses.
- **Domain Metrics**: Prometheus counters and histograms with bounded cardinality.
- **Failure Resilience Scenarios**: Documented, verified degradation for database, Redis, LiveKit, Supabase, network, and hardware failures.
- **Load Benchmarks**: Realistic room scale testing (10, 25, 50, 100 concurrent participants).

---

## 3. Explicitly Out of Scope for MVP 2

To ensure architectural discipline, rapid iteration, and maintainability by a single developer, the following technologies and features are **STRICTLY OUT OF SCOPE** unless explicitly approved in future milestones:

| Category | Excluded Technologies & Features | Rationale / Architectural Boundary |
| :--- | :--- | :--- |
| **Media Transport** | Custom WebRTC SFU, Pion SFU rewrite, Janus, Mediasoup, Kurento | LiveKit is the dedicated, production-tested SFU infrastructure. |
| **Media Streaming** | Video transcoding server, FFmpeg restreaming, RTMP ingestion, HLS/DASH packaging | Loft synchronizes state, not bytes. Providers stream directly to clients. |
| **Third-Party Media** | Spotify Web SDK, SoundCloud Widget, Vimeo, Twitch | Deferred to MVP 3. MVP 2 focuses exclusively on perfecting YouTube. |
| **Message Brokers** | Apache Kafka, RabbitMQ, NATS JetStream, Apache Pulsar | Massive operational overhead. Redis Pub/Sub is sufficient for ephemeral fan-out. |
| **Orchestration** | Kubernetes, Istio/Linkerd service mesh, Nomad clusters | Modular monolith deploys via lightweight Docker Compose / Nomad / fly.io. |
| **Architecture Styles** | Microservices, CQRS, Event Sourcing, Saga orchestrators | Loft uses a Go modular monolith with transactional PostgreSQL and Redis. |
| **Data Synchronization** | CRDTs (Yjs, Automerge), Operational Transformation (OT) | Unnecessary complexity for media queues; monotonic versioning with optimistic locking solves concurrency. |
| **Advanced Moderation** | Automated ML text moderation, image hashing, report triage queues | Basic host lock, kick, and ban satisfy MVP 2 social hangout requirements. |
| **Social / Discovery** | Friends lists, user-to-user DMs, push notifications, global lobby search | Loft hangouts are private/invite-link driven. |
| **Billing & Monetization**| Stripe, subscriptions, tips, virtual gifts | Not part of core realtime room experience. |
| **AI Features** | Speech-to-text, meeting summarization, LLM chat bots, avatars | Heavy computational distraction; orthogonal to low-latency media hangouts. |

---

## 4. Architectural Boundaries (Strict Rules)

1. **WebSocket $\neq$ Media**: Audio, video, and screen-share frames **never** enter the Go WebSocket connection.
2. **Go $\neq$ Video Proxy**: The Go backend **never** downloads, transcodes, or proxies YouTube video bytes.
3. **Redis $\neq$ Database**: Redis holds only ephemeral state (Pub/Sub, TTL presence, rate limits). PostgreSQL is the sole durable source of truth.
4. **Frontend $\neq$ Security Authority**: The client never decides authorization, roles, or room state mutations. Every privileged operation is verified server-side.
5. **LiveKit $\neq$ Application State**: LiveKit handles WebRTC RTP media routing; Go handles application state, chat, and room lifecycle.

---

## 5. Related Documentation
- [Implementation Roadmap (MVP 2 Execution)](file:///d:/git/Loft/docs/roadmap.md)
- [Architecture Overview](file:///d:/git/Loft/docs/architecture.md)
- [System Boundaries](file:///d:/git/Loft/docs/system-boundaries.md)
- [Architecture Decision Records (ADR)](file:///d:/git/Loft/docs/adr/README.md)
- [Engineering Constitution](file:///d:/git/Loft/AGENTS.md)
