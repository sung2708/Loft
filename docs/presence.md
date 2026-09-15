# Realtime Presence & Ephemeral State Architecture — Loft

## 1. Presence Philosophy & Distributed Invariants

Presence represents ephemeral user availability in a room.
1. **Presence is NOT Durable:** Presence data is **never** written to PostgreSQL.
2. **Crash Resilience via TTL:** The system must remain correct even if a Go backend node experiences a hard crash (`kill -9`). Presence entries in Redis expire automatically via TTL.
3. **Single Active Session Per Identity:** A verified identity may have one active room session at a time. A reload in the same browser tab keeps its `tab_session_id` so the server can replace the stale socket without creating a duplicate participant; a different tab is rejected with `DUPLICATE_SESSION`.
4. **Participant Social State:** Raise Hand extends the same typed participant lease with
   `raised_hand` and monotonic `social_version`. Valid reconnect restores it; true removal clears it.

---

## 2. Ephemeral Storage Model (Redis & In-Memory)

Presence is tracked hierarchically using Redis keys with a **15-second TTL**:

```
Key Pattern:
presence:room:<room_id>:members (Redis hash, TTL 30s)
  Field: <livekit_identity> (for example `guest:<uuid>`)
  Value: JSON lease containing:
    {
      "connection_id": "uuid",
      "tab_session_id": "browser-tab-uuid",
      "instance_id": "go-node-01",
      "expires_ms": 1789381200000,
      "participant": { "identity_id": "uuid", "role": "guest" }
    }
  Per-member lease: 15 seconds
```

### Session Admission Rule
- Admission atomically prunes expired hash fields, checks room capacity, and stores one lease per identity.
- A different `tab_session_id` for an existing identity returns `DUPLICATE_SESSION`; it never displaces the original connection.
- The same tab session may replace its previous socket during reload/reconnect, preserving the participant's connection ID and join time.
- If the replacement lands on another Go instance, Redis sends a bounded replacement notification to the old instance so its socket is closed and its exact lease cleanup cannot delete the new connection.

---

## 3. Heartbeat & Expiration Lifecycle

```
 Client (Browser)                  Go Node                       Redis Cluster
        │                             │                                │
        │── Every 10s: heartbeat ────►│                                │
        │   { connection_id }         │── atomic HSET lease (15s) ───►│
        │                             │   (Extends member deadline)    │
        │                             │                                │
  [Tab Closed / WiFi Lost]            │                                │
        │                             │                                │
        X (No heartbeat sent)         │                                │
                                      │                                │
                                      │    (15s passes without ping)   │
                                      │◄── Redis Key Expires ─────────┤
                                      │                                │
                                      │── Next snapshot omits expired │
                                      │   lease; local Hub grace logic │
                                      │   emits participant.left       │
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

## 5. Reconciliation Between Redis and the Hub

- The Go Hub keeps active WebSocket pointers in `roomState.clients`; Redis is only the distributed admission/lease layer.
- `connection.ping` refreshes the 15-second lease. `room.snapshot` reads non-expired remote leases through `ListPresence` and merges them with local participants.
- Explicit leave removes only the exact connection lease. Disconnect grace keeps the lease alive long enough for same-tab replacement.
- If Redis is disconnected, the node falls back to local capacity, identity and rate-limit checks. Cross-instance presence and fan-out are temporarily unavailable, while same-node rooms continue without crashing.
- Social state updates Go authority before Redis refresh outside room locks. Reactions/Waves are not
  snapshot history, and LiveKit remains authoritative for speaking/mic/camera/share state.
