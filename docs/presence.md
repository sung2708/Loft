# Realtime Presence & Ephemeral State Architecture — Loft

## 1. Presence Philosophy & Distributed Invariants

Presence represents ephemeral user availability in a room.
1. **Presence is NOT Durable:** Presence data is **never** written to PostgreSQL.
2. **Crash Resilience via TTL:** The system must remain correct even if a Go backend node experiences a hard crash (`kill -9`). Presence entries in Redis expire automatically via TTL.
3. **Multiple Connections Supported:** A user may legitimately connect from multiple browser tabs or devices simultaneously without corrupting room participant counts.

---

## 2. Ephemeral Storage Model (Redis & In-Memory)

Presence is tracked hierarchically using Redis keys with a **15-second TTL**:

```
Key Pattern:
presence:room:<room_id>:<user_id>:<connection_id>
  Value: JSON string containing:
    {
      "instance_id": "go-node-01",
      "user_id": "uuid",
      "username": "alex",
      "role": "member",
      "is_muted": false,
      "is_deafened": false,
      "last_heartbeat": 1789381200
    }
  TTL: 15 Seconds
```

### Multi-Tab Aggregation Rule
- A user is marked as **Offline** in a room if and only if **zero** active connection keys exist for that `(room_id, user_id)` pair.
- When tab B connects while tab A is already open, the room receives no redundant `participant.joined` event; only the connection registry is incremented.

---

## 3. Heartbeat & Expiration Lifecycle

```
 Client (Browser)                  Go Node                       Redis Cluster
        │                             │                                │
        │── Every 10s: heartbeat ────►│                                │
        │   { connection_id }         │── SETEX presence:... 15s ────►│
        │                             │   (Extends TTL)                │
        │                             │                                │
  [Tab Closed / WiFi Lost]            │                                │
        │                             │                                │
        X (No heartbeat sent)         │                                │
                                      │                                │
                                      │    (15s passes without ping)   │
                                      │◄── Redis Key Expires ─────────┤
                                      │                                │
                                      │── Broadcasts: participant.left │
                                      │   to all room subscribers      │
```

---

## 4. Presence State Transitions

```
                 [DISCONNECTED]
                       │
                       │ (First connection established)
                       ▼
                 [ONLINE / ACTIVE]
                   ▲           │
                   │           │ (Audio/video track muted in LiveKit)
 (Track unmuted)   │           ▼
                   └─── [MUTED / DEAFENED]
                               │
                               │ (Heartbeat expires or socket closed)
                               ▼
                        [DISCONNECTING]
                               │
                               │ (Grace period expires & no sister connection)
                               ▼
                         [OFFLINE]
```

---

## 5. In-Memory Presence Cache in `RoomActor`

To avoid roundtrip Redis lookups on every chat message or broadcast:
- The local Go `RoomActor` maintains an in-memory map: `map[uuid.UUID]*ActivePresence`.
- Updates are pushed to local clients immediately and synchronized across cluster instances via Redis Pub/Sub channel `presence:room:<room_id>`.
- If Redis is disconnected, the node falls back to local in-memory presence tracking, guaranteeing local room continuity without crashing.
