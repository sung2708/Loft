# Redis Architecture & Ephemeral Distributed State — Loft

This document specifies the purpose, data structures, key conventions, and failure handling for Redis in Loft.

---

## 1. Concrete Purpose & Non-Negotiable Boundaries

Redis is introduced in **MVP 2** for one explicit reason: **to enable multiple Go backend instances to coordinate realtime room state and presence without relying on fragile inter-node HTTP meshes or saturating PostgreSQL connection pools.**

### What Redis IS Used For:
1. **Cross-Instance Room Event Bus**: Redis Pub/Sub channels (`room:<room_id>:events`) fan out realtime mutations across all Go monolithic instances.
2. **Ephemeral Presence Leases**: Key expiration (15-second TTL) automatically reaps stale participant records when heartbeats cease.
3. **Distributed Rate Limiting**: Centralized sliding-window counters prevent abuse across multiple backend instances.
4. **Short-Lived Leases**: Coordination locks for host failover and room cleanup.

### What Redis IS NEVER Used For:
1. **Never a Durable Database**: User profiles, room metadata, durable memberships, and chat messages belong **exclusively in PostgreSQL**.
2. **Never Giant Snapshot Blobs**: Redis does not store multi-megabyte room snapshots. Active state is managed in Go memory and synchronized via delta events over Pub/Sub.

> **Absolute Invariant**: If Redis is flushed (`FLUSHALL`) or crashes completely, **zero durable user data is lost**. Only temporary presence leases and rate limit counters reset.

---

## 2. Key Namespaces, TTL Strategy & Data Structures

All Redis keys adhere to a strict hierarchical namespace with mandatory TTLs:

| Key Pattern | Redis Type | TTL | Purpose | Failure / Eviction Consequence |
| :--- | :--- | :---: | :--- | :--- |
| `presence:room:<room_id>:<user_id>:<conn_id>` | String (JSON) | **15s** | Active participant presence lease refreshed every 10s by client heartbeat. | Participant drops from presence list after 15s of silence. |
| `ratelimit:<action>:<identity>` | String (Int) | **60s** | Distributed sliding-window request counter. | Rate limits reset to 0; harmless in development or failover. |
| `lease:room:<room_id>:cleanup` | String (InstanceID)| **30s** | Coordination lease to ensure only one instance executes room DB eviction. | If lease expires, another instance may safely clean up idle room. |
| `channel:room:<room_id>:events` | Pub/Sub | N/A | Inter-node message bus distributing room events. | Delivered instantly to active subscribers; not stored. |

---

## 3. Redis Pub/Sub Architecture & Re-Broadcast Loop Prevention

When a room has participants connected to different backend instances:

```
[ Client A on Instance 1 ]                   [ Client B on Instance 2 ]
            │                                             │
            ▼ (WS: chat.send)                             │
    [ Go Instance 1 ]                                     │
            │                                             │
            ├─► 1. Save to PostgreSQL                     │
            ├─► 2. Local WS Broadcast (Client A)          │
            ▼                                             │
   [ REDIS PUB/SUB ]                                      │
   Channel: room:<id>:events                              │
   Payload: { "origin_instance_id": "inst_1", ... }        │
            │                                             │
            └──────────────► [ Go Instance 2 ]            │
                             │ (origin_instance_id != self)
                             └─► Local WS Broadcast ──────┘
```

### Loop Prevention Invariant
Every event published to Redis Pub/Sub includes the sender's `origin_instance_id`. When a Go instance receives a Pub/Sub packet:
- If `origin_instance_id == current_instance_id`: **Discard immediately** (the instance already delivered the event to its local clients).
- If `origin_instance_id != current_instance_id`: Fan out to local WebSocket clients subscribing to that `room_id`.

---

## 4. Single-Node vs Multi-Instance Mode

To preserve Loft's world-class developer experience, the backend operates seamlessly with or without Redis:

1. **Single-Node Mode (`REDIS_URL` empty)**:
   - Go backend uses standard in-memory maps and channels (`golang.org/x/time/rate`).
   - Zero Redis installation required for local frontend/backend development.
2. **Clustered Mode (`REDIS_URL` configured)**:
   - Go backend connects via `go-redis/v9`.
   - Automatically subscribes to active room channels upon first local participant join; unsubscribes when last local participant leaves.

---

## 5. Redis Outage & Graceful Degradation Handling

If Redis becomes unreachable in a clustered production environment:
1. **Detection**: Redis client health ping detects connection timeout ($<500\text{ms}$).
2. **Circuit Breaker & Logging**: Logs structured warning (`slog.Error("redis unavailable, operating in degraded mode")`).
3. **Graceful Local Fallback**:
   - The Go backend falls back to local in-memory rate limiting and in-memory presence tracking for its own connected clients.
   - Cross-instance broadcast pauses, but clients connected to the same instance continue chatting and syncing media normally.
4. **No Process Panics**: The Go process **never panics or crashes** due to Redis outages.
5. **Automatic Reconnection**: The Redis client retries connection with exponential backoff and resubscribes to active room channels automatically once Redis recovers.
