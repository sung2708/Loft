# Canonical Room State Management — Loft

This document establishes the state architecture, state domain boundaries, and concurrency locking rules for Loft rooms.

---

## 1. Authoritative State Partitioning Model

To avoid database bottlenecks while ensuring zero data loss and deterministic synchronization, room state is partitioned into four distinct operational domains:

```
+-------------------------------------------------------------------------------+
|                             CANONICAL ROOM STATE                              |
+-----------------------+-------------------------------+-----------------------+
|  1. DURABLE STATE     |  2. EPHEMERAL STATE           |  3. DERIVED STATE     |
|     (PostgreSQL)      |     (Go Memory + Redis)       |     (Deterministic)   |
| ───────────────────── | ───────────────────────────── | ───────────────────── |
| • Room ID, slug, name | • Active participant conns    | • Instantaneous media |
| • Room owner profile  | • Active media playback anchor|   playback position   |
| • Durable memberships | • In-memory collaborative     | • Clock skew offset   |
| • Chat message log    |   queue (max 50 items)        | • Participant count   |
| • Room lock/ban flags | • Monotonic state version     |                       |
+-----------------------+-------------------------------+-----------------------+
                        |  4. CLIENT-LOCAL STATE        |
                        |     (Zustand Stores)          |
                        | ───────────────────────────── |
                        | • Open drawer (chat/music/etc)|
                        | • Selected camera/mic devices |
                        | • Video effect configuration  |
                        | • Player volume & mute status |
                        +-------------------------------+
```

---

## 2. Comprehensive State Domain Matrix

| Domain Category | Specific Fields / Entities | Primary Source of Truth | Secondary / Cache Layer | Persistence Policy |
| :--- | :--- | :--- | :--- | :--- |
| **Durable Room** | `id`, `slug`, `name`, `owner_id`, `allow_guests`, `max_participants` | **PostgreSQL** (`rooms`) | Go In-Memory Room Cache | Transactional SQL. Retained indefinitely. |
| **Durable Chat** | `id`, `room_id`, `sender_id`, `content`, `created_at` | **PostgreSQL** (`messages`) | Client Zustand `useChatStore` | Inserted upon receipt. Retained indefinitely. |
| **Active Version** | `version: uint64` (monotonic sequence number) | **Go Room Authority** | Redis Pub/Sub Broadcast | Incremented on every valid state mutation. |
| **Media State** | `current`, `status` (`IDLE`/`PLAYING`/`PAUSED`), `position_ms`, `started_at`, `repeat` | **Go Room Authority** | Broadcast via `media.state` | Maintained in memory. Evicted 10 mins after room empties. |
| **Collaborative Queue** | `queue: []youtubeTrack` (UUID, `video_id`, `added_by`, `title`) | **Go Room Authority** | Synchronized in `room.snapshot` | Maintained in memory during active room lifecycle. |
| **Presence Leases** | Active participant list, online connections, heartbeats | **Redis TTLs** (15s) | Go `state.clients` map | Evaporates automatically if heartbeats cease. |
| **Media Tracks** | Audio, camera, screen-share tracks, mute states | **LiveKit SFU** | `@livekit/components-react` | Ephemeral WebRTC session. Closed on disconnect. |
| **UI & Preferences**| Active drawer, camera effects, volume slider, draft messages | **Client Zustand** | `sessionStorage` / `localStorage` | Never transmitted to or stored on server. |

Persistent room access policy (`allow_guests`, `password_required`, `is_locked`, and `version`) is
durable PostgreSQL state. A password verifier is server-only and is never placed in snapshots or
client payloads. Presence, reconnect sessions, and in-memory eviction remain ephemeral; an empty
room or browser disconnect never deletes durable room metadata.

---

## 3. Canonical Room State Struct (Go Backend)

```go
type CanonicalRoomState struct {
    // Durable Room Reference
    Room domain.Room `json:"room"`

    // Monotonically increasing room version
    Version uint64 `json:"version"`

    // Active in-memory participants (connection_id -> client)
    Participants map[string]*Client `json:"participants"`

    // Authoritative media playback and queue state
    Media MediaState `json:"media"`

    // Lifecycle eviction timer (10 minutes after last participant leaves)
    EvictTimer *time.Timer `json:"-"`

    // Playback progression timer (fires at canonical end of current video)
    MediaTimer *time.Timer `json:"-"`
}
```

---

## 4. Concurrency Invariants & Lock Scopes

In the Go backend, room state mutations are governed by strict thread-safety rules:

1. **Short Critical Sections**:
   - `Hub.mu (sync.RWMutex)` protects room lookups and membership registrations.
   - Lock holding time must be strictly sub-millisecond ($<50\mu\text{s}$).
2. **Zero I/O Under Locks**:
   - **Never** execute database queries (`pgxpool`), Redis commands, LiveKit HTTP requests, or WebSocket socket writes while holding `Hub.mu` or room mutexes.
3. **Copy Before Broadcast**:
   - The broadcaster acquires a read lock (`mu.RLock`), copies the active client pointers into a slice, releases the read lock (`mu.RUnlock`), and only then iterates over the slice to enqueue data into client channels.
4. **Optimistic Mutation Guard**:
   - Every state-mutating command from a client must supply `expected_version`.
   - If `command.ExpectedVersion != state.version`, the mutation is rejected with `errMediaStale`. This guarantees race-free sequential consistency across concurrent room members.

---

## 5. Lifecycle Transitions & Eviction Policy

```
[ Room Created / First WS Join ]
              │
              ▼
      [ Room Active (1..12 participants) ]
              │
              ├── (Participant Leaves) ──► (Still >= 1 active: Continue)
              │
              ▼ (Last participant disconnects)
      [ EVICTION GRACE PERIOD: 10 Minutes ]
              │
              ├── (User rejoins within 10m) ──► [ Grace Timer Cancelled, Room Resumed ]
              │
              ▼ (Timer expires)
      [ Clean In-Memory Eviction ]
      - Stop media progression timer
      - Delete room state from Go RAM / Redis
      - Durable metadata and messages remain safely in PostgreSQL
```

## 6. Owner and Realtime Host

`rooms.owner_id` remains the durable owner and controls persistent room
settings. The Go Hub separately tracks the current realtime host by public
participant connection ID, identity, generation, and monotonic authority
version. A host transfer changes only the active authority; it never changes
the durable owner.

Temporary transport loss keeps the host in `grace-period`. Reconnection from
the same tab/generation restores the host. When grace expires, the Hub selects
one deterministic authenticated participant by join order and connection ID;
if none is eligible, the room has no active host until an eligible participant
joins. Every transition is published as `host.changed` and included in the
next `room.snapshot`.

## 7. Participant Social State

Raise Hand is self-controlled current participant state with a monotonic social version. Valid
same-tab reconnect preserves it; stale sockets cannot overwrite a newer generation. True leave,
grace expiry, kick, temporary ban, and room teardown clear it. Snapshots recover current hands,
while reactions and room-level Waves remain ephemeral. LiveKit remains authoritative for speaking,
microphone, camera, and screen share.
