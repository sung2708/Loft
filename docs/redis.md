# Redis Architecture & Ephemeral Distributed State — Loft

This document specifies the purpose, data structures, key conventions, and failure handling for Redis in Loft.

---

## 1. Concrete Purpose & Non-Negotiable Boundaries

Redis is introduced in **MVP 2** for one explicit reason: **to enable multiple Go backend instances to coordinate realtime room state and presence without relying on fragile inter-node HTTP meshes or saturating PostgreSQL connection pools.**

### What Redis IS Used For:
1. **Cross-Instance Room Event Bus**: Redis Pub/Sub channels (`room:<room_id>:events`) fan out realtime mutations across all Go monolithic instances.
2. **Ephemeral Presence Leases**: Key expiration (15-second TTL) automatically reaps stale participant records when heartbeats cease.
3. **Distributed Rate Limiting**: Centralized token buckets prevent abuse across multiple backend instances.
4. **Short-Lived Media Lease**: A fenced ownership token serializes ordered media mutations across instances.

### What Redis IS NEVER Used For:
1. **Never a Durable Database**: User profiles, room metadata, durable memberships, and chat messages belong **exclusively in PostgreSQL**.
2. **Never Giant Snapshot Blobs**: Redis does not store multi-megabyte room snapshots. Active state is managed in Go memory and synchronized via delta events over Pub/Sub.

> **Absolute Invariant**: If Redis is flushed (`FLUSHALL`) or crashes completely, **zero durable user data is lost**. Only temporary presence leases and rate limit counters reset.

---

## 2. Key Namespaces, TTL Strategy & Data Structures

All Redis keys adhere to a strict hierarchical namespace with mandatory TTLs:

| Key Pattern | Redis Type | TTL | Purpose | Failure / Eviction Consequence |
| :--- | :--- | :---: | :--- | :--- |
| `presence:room:<room_id>:members` | Hash of JSON leases | **30s hash / 15s member** | One active session per identity; refreshed by `connection.ping`. | Expired members are pruned on admission/heartbeat and disappear from snapshots. |
| `ratelimit:<action>:<sha256(identity)>` | Hash (`tokens`, `updated_ms`) | Policy-derived | Distributed token bucket for connections, guest/room creation, chat, reactions, and media commands. | Rate limits reset to 0; local bounded limiter continues during outage. |
| `lease:room:<room_id>:media_owner` | String (fenced token) | **30s** | One instance owns ordered media mutations and timer progression. | Lease expiry fences the writer; another instance can acquire it. |
| `room:<room_id>:media_snapshot` | JSON string | **20m** | Short-lived failover snapshot for media authority hydration. | Cache loss resets only ephemeral media state; PostgreSQL durable data is unaffected. |
| `room:<room_id>:events` | Pub/Sub | N/A | Inter-node message bus distributing room events. | Delivered instantly to active subscribers; not stored. |
| `instance:<id>:media_rpc` / `media_reply` | Pub/Sub | N/A | Forward media commands to the current media owner. | Owner failure returns a bounded command error; caller retries after snapshot recovery. |
| `instance:<id>:presence_replace` | Pub/Sub | N/A | Tell the old node to close a same-tab socket replaced on another node. | Exact lease cleanup prevents the old socket from deleting the new lease. |
| `instance:<id>:presence_kick` | Pub/Sub | N/A | Route a host eviction to the node that owns the target socket. | Durable ban remains authoritative if the target node is unavailable. |

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
   - A single bounded wildcard subscription (`room:*:events`) receives active room fan-out; no per-room subscription goroutine is created.
   - Four bounded media RPC workers service cross-instance owner forwarding.

---

## 5. Redis Outage & Graceful Degradation Handling

If Redis becomes unreachable in a clustered production environment:
1. **Detection**: Redis client health ping detects connection timeout ($<500\text{ms}$).
2. **Bounded fallback & Logging**: Logs a structured warning and uses local bounded limiters/admission when commands fail.
3. **Graceful Local Fallback**:
   - The Go backend falls back to local in-memory rate limiting and in-memory presence tracking for its own connected clients.
   - Cross-instance broadcast pauses, but clients connected to the same instance continue chatting and syncing media normally.
4. **No Process Panics**: The Go process **never panics or crashes** due to Redis outages.
5. **Automatic Reconnection**: The Redis client retries connection with exponential backoff and resumes its bounded wildcard room subscription automatically once Redis recovers.

## 6. SPEC 003 Social Coordination

- Existing room Pub/Sub carries bounded Reaction, Wave, and Raise Hand facts.
- Existing distributed buckets prevent cross-instance reaction/Wave limit bypass.
- Presence leases carry current Raise Hand state; Redis never becomes durable social history.
- During outage, cross-instance social delivery may degrade while same-node rooms and calls continue.
- Recovery uses fresh current state and never replays expired reactions or Waves.
