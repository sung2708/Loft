# Redis Architecture & Ephemeral State Design — Loft

## 1. Redis Purpose & Explicit Non-Goals

Redis serves as an ephemeral coordination accelerator and cross-instance communication bus.
- **What Redis IS For:**
  - Fast presence key expiration via TTLs.
  - Inter-node message broadcasting via Redis Pub/Sub.
  - Sliding-window rate-limiting counters.
  - Distributed lock leases for leader election during host failover.
- **What Redis IS NOT For:**
  - Durable user or room storage.
  - Permanent chat history archive.
  - Event sourcing or audit log storage.

> **Absolute Rule:** If a Redis cluster is flushed (`FLUSHALL`) or restarted, the platform must continue functioning without data loss. Only temporary presence and active rate limits will reset.

---

## 2. Key Namespaces & Expiration Policies

All Redis keys follow a strict hierarchical namespace with mandatory TTLs:

| Key Pattern | Data Structure | TTL | Purpose |
| :--- | :--- | :--- | :--- |
| `presence:room:<room_id>:<user_id>:<conn_id>` | String (JSON) | 15 Seconds | Ephemeral presence lease refreshed by client heartbeats. |
| `ratelimit:<action>:<identity>` | String (Integer) | 60 Seconds | Sliding window counter for rate limit enforcement. |
| `lease:room:failover:<room_id>` | String (InstanceID) | 5 Seconds | Mutex lock to ensure only one node conducts host election. |
| `cache:user:profile:<user_id>` | String (JSON) | 5 Minutes | Read-through cache for user profile metadata. |

---

## 3. Redis Pub/Sub Architecture & Inherent Limitations

In a multi-node Go deployment, WebSocket connections to the same room may land on different Go instances. Redis Pub/Sub acts as the inter-node fan-out fabric:

```
 Node 1 (Receives Chat)              Redis Broker              Node 2 (Connected Client)
       │                                  │                               │
       │── PUBLISH room:<id>:events ─────►│                               │
       │   { type: "chat.message", ... }  │── DELIVER to subscribers ────►│
       │                                  │                               │── Writes to client socket
```

### Critical Pub/Sub Limitations (Must-Know Invariants)
1. **Fire-and-Forget Delivery:** Redis Pub/Sub does **not** persist messages. If a Go node is momentarily disconnected or restarts, messages published during that window are permanently dropped by the broker.
2. **No Replay or Backlog:** Unlike Kafka or Redis Streams, Pub/Sub does not support offset replay.
3. **Architectural Consequence:** We **never** rely on Pub/Sub as the authoritative transport for critical state recovery. If an event is missed, clients resynchronize using Go's authoritative `room.snapshot`.

---

## 4. Single-Node vs. Multi-Instance Transition

Loft is intentionally designed to run seamlessly in two modes:

### Mode 1: Local Development / Single-Node (Zero Redis Dependency)
- If `REDIS_URL` is empty or disabled, the Go monolith falls back automatically to **in-memory room fan-out channels** and in-memory rate limiters (`golang.org/x/time/rate`).
- Developers can clone the repository and run the full backend locally without installing or launching Redis.

### Mode 2: Multi-Instance Cluster
- Enabled when `REDIS_URL` is configured.
- The `RoomHub` subscribes to Redis channels and publishes state updates across the cluster.

---

## 5. Redis Disconnection & Degradation Handling

If Redis becomes unreachable in production:
1. **Health Check Detection:** The background Redis ping check fails and trips the circuit breaker.
2. **Local Fallback:** The instance logs an alert (`slog.Error("redis unavailable, operating in degraded mode")`) and temporarily falls back to local in-memory presence tracking and local rate limiting.
3. **No Process Panic:** The Go backend continues serving existing connections and HTTP traffic; it does not panic or crash.
4. **Auto-Reconnection:** The `go-redis` client automatically reconnects with exponential backoff once the Redis service recovers.
