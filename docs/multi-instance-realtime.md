# Multi-Instance Realtime Architecture — Loft

This document specifies the distributed communication topology, event propagation, and loop-prevention mechanics when multiple Go backend instances serve participants of the same room.

---

## 1. Multi-Instance Topology

In production, client WebSocket connections are load-balanced across multiple Go monolithic instances:

```
[ Client A ]                         [ Client B ]
     │                                    │
     ▼ (WebSocket)                        ▼ (WebSocket)
┌─────────────────────────┐          ┌─────────────────────────┐
│     GO INSTANCE 1       │          │     GO INSTANCE 2       │
│  Instance ID: inst_east │          │  Instance ID: inst_west │
│  Local Room Clients:    │          │  Local Room Clients:    │
│  - Client A             │          │  - Client B             │
└────────────┬────────────┘          └────────────▲────────────┘
             │                                    │
             │ PUBLISH room:xyz:events            │ DELIVER
             ▼                                    │
    ┌──────────────────────────────────────────────────┐
    │                 REDIS PUB/SUB BUS                │
    │             Channel: room:<id>:events            │
    └──────────────────────────────────────────────────┘
```

---

## 2. Event Distribution Flow

When Client A dispatches a chat message or media command:
1. **Ingestion & Validation**: Instance 1 receives the event on Client A's WebSocket, authenticates identity, and validates payload schema.
2. **Durable Persistence (if applicable)**:
   - For chat: Instance 1 executes `INSERT INTO messages` in PostgreSQL.
   - For media: Instance 1 verifies `expected_version`, mutates in-memory `mediaState`, and increments `version++`.
3. **Local Fan-Out**: Instance 1 broadcasts the event directly to its locally connected room clients (Client A).
4. **Inter-Node Publication**: Instance 1 wraps the event in an inter-node distribution envelope and publishes it to Redis channel `room:<room_id>:events`.
5. **Subscription & Remote Fan-Out**:
   - Instance 2 (subscribed to `room:<room_id>:events` because Client B is connected) receives the message.
   - Instance 2 verifies `origin_instance_id != "inst_west"`.
   - Instance 2 iterates through its local connection map for `room_id` and enqueues the frame to Client B's outbound buffer.

---

## 3. Distributed vs Local State Boundaries

| State Element | Distribution Scope | Synchronization Mechanism |
| :--- | :--- | :--- |
| **Room Metadata** | Global | PostgreSQL durable read/write. |
| **Active Participants** | Distributed Aggregation | Aggregated via Redis presence keys `presence:room:<id>:*`. |
| **Media Playback State** | Global Sequential | Evaluated by receiving instance, version-incremented, published via Redis. |
| **Collaborative Queue** | Global Sequential | Incremented monotonic `version` over Redis Pub/Sub. |
| **Chat Messages** | Global | Inserted to PostgreSQL, fanned out via Redis Pub/Sub. |
| **Ephemeral Reactions** | Ephemeral Global | Broadcast over Redis Pub/Sub (best-effort, unbuffered). |
| **WebSocket Socket Pointers**| Strictly Local | Kept in local Go RAM (`state.clients map[string]*client`). |
| **LiveKit Tokens** | Local REST Generation | Generated locally by each instance using shared `LIVEKIT_API_SECRET`. |

---

## 4. Re-Broadcast Loop Prevention

### The Risk
If Instance 2 blindly re-publishes incoming Redis messages back to Redis, an infinite feedback loop crashes the cluster and exhausts bandwidth.

### The Invariant Solution: Inter-Node Envelope
Every packet broadcast over Redis Pub/Sub uses the inter-node transport schema:

```json
{
  "origin_instance_id": "inst_east_7a9f",
  "room_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
  "event_id": "c73d9e84-1b72-4d26-9f4a-71829e81b674",
  "event_data": {
    "type": "chat.message",
    "version": 1,
    "event_id": "c73d9e84-1b72-4d26-9f4a-71829e81b674",
    "room_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
    "payload": { ... }
  }
}
```

### Ingestion Logic:
```go
func (h *Hub) handleRedisMessage(msg *redis.Message) {
    var packet InterNodeEnvelope
    if err := json.Unmarshal([]byte(msg.Payload), &packet); err != nil {
        return
    }

    // 1. Loop Prevention Guard
    if packet.OriginInstanceID == h.instanceID {
        return // Already processed and delivered locally
    }

    // 2. Broadcast strictly to local clients of this room
    h.broadcastLocal(packet.RoomID, packet.EventData, "")
}
```

---

## 5. Channel Subscription Lifecycle

To conserve Redis resources and network bandwidth, an instance only subscribes to Redis channels for rooms that have at least one active local WebSocket connection:

1. **First Participant Joins Room on Instance X**:
   - Instance X registers client.
   - Instance X subscribes to Redis channel `room:<room_id>:events`.
2. **Subsequent Participants Join on Instance X**:
   - Reuses existing Redis subscription.
3. **Last Local Participant Leaves Instance X**:
   - Instance X unsubscribes from Redis channel `room:<room_id>:events`.
   - Halts inter-node traffic for idle rooms on this instance.

---

## 6. Related Documentation
- [Redis Architecture & Ephemeral State Design](file:///d:/git/Loft/docs/redis.md)
- [Canonical Room State Management](file:///d:/git/Loft/docs/room-state.md)
- [Realtime Protocol Specification](file:///d:/git/Loft/docs/realtime-protocol.md)
- [Concurrency, Thread Safety & Backpressure](file:///d:/git/Loft/docs/concurrency.md)
- [ADR-004: Redis for Ephemeral State and Inter-Node Fan-Out](file:///d:/git/Loft/docs/adr/README.md#adr-004-redis-for-ephemeral-state-and-inter-node-fan-out)
