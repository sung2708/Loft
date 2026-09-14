# Realtime Protocol Specification — Loft

This document specifies the bidirectional WebSocket protocol for Loft. Section 1 documents the **authoritative MVP 1 protocol** currently running in the repository. Section 2 specifies the **proposed MVP 2 protocol extensions**.

---

## 1. Authoritative MVP 1 Protocol (Current Codebase)

### Envelope Standard (`backend/internal/realtime/hub.go`)

Every packet transmitted over the WebSocket connection uses the strict JSON envelope:

```json
{
  "type": "chat.send",
  "version": 1,
  "event_id": "c73d9e84-1b72-4d26-9f4a-71829e81b674",
  "room_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
  "payload": {}
}
```

- `type` (string): Mandatory event name.
- `version` (int): Protocol version (must be `1`).
- `event_id` (UUIDv4 string): Unique message identifier.
- `room_id` (string): Target room identifier (optional only on initial auth).
- `payload` (JSON object): Strongly typed schema payload.

---

### MVP 1 Connection Events

#### `connection.auth`
- **Direction**: Client → Server
- **Authentication**: Pre-auth
- **Authorization**: Public
- **Payload**:
  ```json
  { "token": "<supabase_jwt_or_guest_token>", "room_id": "<room_uuid>", "tab_session_id": "<browser_tab_uuid>" }
  ```
- **Validation**: Token must verify via `GuestTokens.Verify` or `SupabaseVerifier.Verify`. Room must exist and admit user/guest. `tab_session_id` persists through a browser reload and lets the server replace the prior connection from that same tab.
- **Source of Truth**: Supabase Auth / Go Guest HMAC.
- **Idempotency**: Sent once immediately upon WebSocket connect.
- **Version Implication**: None.
- **Server Response**: Immediately sends `room.snapshot` on success, or closes socket on failure.

#### `connection.ping` / `connection.pong`
- **Direction**: Client → Server (`ping`) / Server → Client (`pong`)
- **Payload (`ping`)**: `{ "client_time": 1789381200100 }`
- **Payload (`pong`)**: `{ "client_time": 1789381200100, "server_time": 1789381200115 }`
- **Validation**: Integer millisecond timestamps.
- **Source of Truth**: Ephemeral server clock.
- **Purpose**: Heartbeat keepalive (every 10s) and client clock offset calibration.

---

### MVP 1 Room & Participant Events

#### `room.snapshot`
- **Direction**: Server → Client
- **Authentication**: Admitted session
- **Payload**:
  ```json
  {
    "room": {
      "id": "uuid",
      "slug": "abc-xyz",
      "name": "Loft Hangout",
      "owner_id": "uuid",
      "allow_guests": true,
      "max_participants": 12,
      "created_at": "2026-09-14T10:00:00Z"
    },
    "self": {
      "connection_id": "uuid",
      "identity_id": "uuid",
      "identity_type": "user",
      "display_name": "Alex",
      "avatar_url": "https://...",
      "role": "host",
      "livekit_identity": "user:uuid",
      "joined_at": "2026-09-14T10:00:00Z"
    },
    "participants": [ /* array of Participant objects */ ],
    "messages": [ /* 50 most recent Message objects */ ],
    "media": {
      "current": { "id": "uuid", "video_id": "dQw4w9WgXcQ", "added_by": "Alex", "title": "...", "duration_sec": 212 },
      "queue": [ /* array of youtubeTrack */ ],
      "repeat": false,
      "status": "PLAYING",
      "position_ms": 12400,
      "started_at": "2026-09-14T10:00:00Z",
      "version": 4
    }
  }
  ```
- **Source of Truth**: In-memory `roomState` + PostgreSQL message history.

#### `participant.joined`
- **Direction**: Server → Client (Broadcast)
- **Payload**: Full `Participant` object of joining peer.

#### `participant.left`
- **Direction**: Server → Client (Broadcast)
- **Payload**: `{ "connection_id": "uuid" }`

---

### MVP 1 Chat & Reaction Events

#### `chat.send` → `chat.message`
- **Direction**: `chat.send` (Client → Server) → `chat.message` (Server → Client Broadcast)
- **Payload (`chat.send`)**: `{ "content": "Hello world!" }`
- **Validation**: 1–2000 runes, trimmed. Rate limit: 5 msgs / 3s.
- **Source of Truth**: PostgreSQL `messages` table.

#### `reaction.send` → `reaction.sent`
- **Direction**: `reaction.send` (Client → Server) → `reaction.sent` (Server → Client Broadcast)
- **Payload**: `{ "emoji": "🔥" }`
- **Validation**: Strict emoji set: `❤️`, `🔥`, `👏`, `😂`, `👍`, `🎉`. Max 4 per client, 20 per room per 2s.
- **Source of Truth**: Ephemeral broadcast (dropped for slow consumers).

---

### MVP 1 Media & Queue Events

- **Events**: `media.play`, `media.pause`, `media.seek`, `media.duration`, `media.repeat`, `queue.add`, `queue.next`, `queue.select`, `queue.remove`, `queue.clear`, `queue.shuffle`, `queue.reorder`.
- **Direction**: Client → Server → Server broadcasts resulting `media.state`.
- **Validation**: Must pass `expected_version == media.Version` check.
- **Authorization**: `CanControlMedia` for playback controls; `CanManageQueue` for queue additions/mutations.
- **Broadcast (`media.state`)**: Full snapshot of `mediaState` with incremented monotonic `version`.

---

## 2. Proposed MVP 2 Protocol Extensions

To support MVP 2 governance, multi-instance presence, and collaborative features, the following events are defined:

```
Domain Hierarchy:
├── room.*        (Governance, state snapshots)
├── presence.*    (Heartbeats, connection status)
├── media.*       (Playback control, drift resync)
├── queue.*       (Collaborative queue management)
└── permission.*  (Role assignment, capability grants)
```

---

### A. Room Governance Family (`room.*`)

#### `room.lock`
- **Direction**: Client → Server
- **Authorization**: Host only (`identity.ID == room.OwnerID`)
- **Payload**:
  ```json
  { "locked": true, "expected_version": 14 }
  ```
- **Validation**: Boolean `locked` flag. `expected_version` matches room state.
- **Source of Truth**: Go Room Authority + PostgreSQL `rooms.is_locked`.
- **Idempotency**: Safe to repeat with matching expected version.
- **Version Implications**: Increments `room.version++`.

#### `room.locked`
- **Direction**: Server → Client (Broadcast)
- **Payload**:
  ```json
  { "locked": true, "locked_by": "uuid", "version": 15 }
  ```

#### `participant.kick`
- **Direction**: Client → Server
- **Authorization**: Host only
- **Payload**:
  ```json
  { "connection_id": "uuid", "reason": "Disruptive behavior" }
  ```
- **Validation**: Target must be an active participant and cannot be the host.
- **Source of Truth**: Go Room Authority.
- **Server Action**: Closes target socket with `StatusPolicyViolation`, revokes LiveKit token, and broadcasts `participant.left`.

---

### B. Presence Family (`presence.*`)

#### `presence.heartbeat`
- **Direction**: Client → Server
- **Authorization**: Admitted participant
- **Payload**:
  ```json
  { "client_time": 1789382000000, "is_speaking": false, "is_video_on": true }
  ```
- **Validation**: Timestamp validation. Rate limit: 1 per 10s.
- **Source of Truth**: Redis key `presence:room:<room_id>:<user_id>:<conn_id>` with 15s TTL.
- **Idempotency**: Idempotent lease refresh.

---

### C. Media Synchronization Family (`media.*`)

#### `media.resync`
- **Direction**: Client → Server
- **Authorization**: Admitted participant
- **Payload**:
  ```json
  { "client_position_ms": 45200, "reason": "LARGE_DRIFT" }
  ```
- **Validation**: Positive integer millisecond offset.
- **Source of Truth**: Go In-Memory Room Authority.
- **Server Action**: Returns immediate `media.state` snapshot containing current anchor.

---

## 3. Strict Protocol Non-Goals

1. **No Vague Events**: Events named `update`, `sync`, `change`, or `refresh` are strictly forbidden. All events must follow explicit `noun.verb` notation (e.g. `media.pause`, `queue.reorder`).
2. **No Raw Media Data**: Audio/video binary packets in WebSocket messages are prohibited and rejected with immediate socket closure.
3. **No Unbounded Arrays in Payloads**: Payloads with arrays (e.g. `queue.reorder`) must enforce hard item length caps ($\le 50$).
