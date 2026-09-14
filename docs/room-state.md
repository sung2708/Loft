# Room State Management & Lifecycle — Loft

## 1. Canonical Room State Model

In Loft, the room is the central aggregation boundary. To guarantee consistency without database thrashing, room state is split into **Durable Attributes** (PostgreSQL) and **Active Ephemeral State** (in-memory Go `RoomActor` synchronized via Redis).

```go
type CanonicalRoomState struct {
    RoomID        uuid.UUID                      `json:"room_id"`
    Version       uint64                         `json:"version"`        // Monotonically increasing
    HostID        uuid.UUID                      `json:"host_id"`        // Current authoritative room host
    Participants  map[uuid.UUID]*RoomParticipant `json:"participants"`   // Active online members
    Permissions   RoomPermissionSet              `json:"permissions"`    // Room-level policy overrides
    Media         MediaPlaybackState             `json:"media"`          // Canonical playback cursor
    Queue         []QueueItem                    `json:"queue"`          // Ordered media queue
    ActiveShare   *ScreenShareState              `json:"active_share"`   // Primary presenter info
    UpdatedAt     time.Time                      `json:"updated_at"`
}
```

---

## 2. State Breakdown & Ownership

| Component | Nature | Storage Authority | Sync Strategy |
| :--- | :--- | :--- | :--- |
| **Room Metadata (Name, Settings)**| Durable | PostgreSQL | Loaded on startup; updated via transactional SQL. |
| **Memberships & Base Roles** | Durable | PostgreSQL | Loaded into memory on room creation; updated via Go service. |
| **State Version (`uint64`)** | In-Memory Ephemeral | Go `RoomActor` | Incremented on every valid state-changing event. |
| **Active Playback Position** | Computed Realtime | Go `RoomActor` | Synchronized via `(base_position, started_at_server_time)`. |
| **Media Queue** | Semi-durable | Go `RoomActor` (memory) | Written to Postgres on major queue transitions. |
| **Presence & Mute State** | Ephemeral | Redis + Go Memory | Heartbeat refreshed every 15s; dropped on disconnect. |
| **WebRTC Media Tracks** | LiveKit SFU | LiveKit Server | Track state reported to Go via server webhooks. |
| **UI Drawer / Layout State** | Client-local | Client Zustand Store | Never synchronized to backend. |

---

## 3. Monotonic Versioning & Snapshot Strategy

Every mutation that alters room structure, playback state, permissions, or queue ordering increments the `version` counter by exactly 1:

$$\text{Version}_{n+1} = \text{Version}_n + 1$$

### Invariant Rules
1. **Server Authority:** The Go `RoomActor` is the **only** entity permitted to increment `room.version`.
2. **Client Mutation Guard:** Client commands that mutate state must supply an `expected_version`. If `expected_version != actor.version`, the command is rejected as stale (`ERROR_STALE_VERSION`), preventing split-brain overwrites from concurrent users.
3. **Snapshot Reconciliation:** Clients maintain `local_version`. If an event is received with `sequence > local_version + 1`, the client triggers a snapshot fetch (`room.snapshot`) rather than trying to replay missing events.

---

## 4. Host Failover & Grace Period Engine

The **Room Host** possesses elevated capabilities (e.g., kicking, room settings, media override). If the host experiences transient network loss (e.g. WiFi hiccup, laptop lid shut for 5 seconds), ownership must not instantly flutter to another user.

### Failover State Machine

```
[Host Connected]
       │
       ▼ (Host TCP Drop / WebSocket EOF)
[GRACE PERIOD: 15s Timer Started]
       │
       ├── (Host reconnects within 15s) ──► [Host Reclaimed, Timer Cancelled]
       │
       ▼ (Timer Expires)
[DETERMINISTIC SUCCESSOR ELECTION]
       │
       ├─► 1. Longest-tenured active Moderator
       ├─► 2. Longest-tenured active Member
       └─► 3. If room empty: Freeze room actor -> Graceful eviction to DB
```

### Deterministic Election Invariant
To prevent election races when multiple backend nodes or members are active:
- The election query sorts candidates deterministically:
  ```
  ORDER BY role = 'moderator' DESC, joined_at ASC, user_id ASC LIMIT 1
  ```
- The new host ID is committed to PostgreSQL in a transaction:
  ```sql
  UPDATE rooms SET host_id = $1, updated_at = NOW() WHERE id = $2 AND host_id = $old_host_id;
  ```
- The `RoomActor` bumps `version` and broadcasts `room.host_transferred { new_host_id: "...", reason: "TIMEOUT" }`.

---

## 5. Concurrency & In-Memory Locking Rules

Within the Go `RoomActor`:
1. **Short Critical Sections:** Locks are held only during state inspection and assignment in memory (typically $< 50 \mu s$).
2. **Lock Order:** Always acquire `RoomManager.registryLock` (if needed) **before** `RoomActor.mu`. Never reverse this order.
3. **Zero I/O Inside Locks:** Database calls (`pgx`), Redis network trips, and WebSocket client writes must be scheduled outside the lock.
