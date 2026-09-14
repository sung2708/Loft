# Realtime Protocol Specification — Loft (v1)

## 1. Protocol Architecture & Envelope Standard

All realtime WebSocket communication across Loft uses a strictly typed, versioned JSON envelope. Dynamic untyped payloads (`map[string]interface{}` or `any`) are strictly prohibited in backend handlers and frontend stores.

### The Canonical Envelope

```json
{
  "type": "media.play",
  "protocol_version": 1,
  "event_id": "c73d9e84-1b72-4d26-9f4a-71829e81b674",
  "room_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
  "sequence": 184,
  "sent_at": "2026-09-14T10:45:00.124Z",
  "payload": {}
}
```

### Envelope Fields Specification

| Field | Type | Description | Mandatory |
| :--- | :--- | :--- | :--- |
| `type` | String | Dot-notated family and action (e.g., `media.play`, `chat.message`). | Yes |
| `protocol_version` | Integer | Protocol schema version (current: `1`). | Yes |
| `event_id` | UUIDv4 | Unique client- or server-generated event identifier for tracing & idempotency. | Yes |
| `room_id` | UUIDv4 | Target room identifier. Omitted only during initial connection auth handshake. | Conditional |
| `sequence` | Int64 | Monotonically increasing room sequence number issued by Go backend. Sent on server events. | Server Events |
| `sent_at` | RFC3339 | Timestamp when the sender dispatched the packet. | Yes |
| `payload` | Object | Strongly typed schema payload for the specific event type. | Yes |

---

## 2. Event Families & Comprehensive Catalog

### A. Connection Family (`connection.*`)

#### `connection.auth`
- **Direction:** Client → Server
- **Authentication:** None (establishes auth)
- **Authorization:** Public
- **Payload:**
  ```json
  { "token": "<supabase_jwt_or_guest_token>", "client_version": "1.0.0" }
  ```
- **Source of Truth:** Supabase Auth / Go Guest HMAC
- **Persistence:** None
- **Ordering:** Must be the very first packet after WebSocket handshake.
- **Idempotency:** Token verified once per connection.
- **Error Behavior:** Server responds with `connection.error` (code: `UNAUTHORIZED`) and terminates socket.
- **Broadcast:** None.

#### `connection.authenticated`
- **Direction:** Server → Client
- **Authentication:** Validated session
- **Payload:**
  ```json
  { "user_id": "uuid", "is_guest": false, "username": "alex", "avatar_url": "https://..." }
  ```
- **Source of Truth:** Go Auth context.

#### `connection.ping` / `connection.pong`
- **Direction:** Bidirectional
- **Payload:** `{ "client_time": 1789381200100, "server_time": 1789381200115 }`
- **Purpose:** Heartbeat keepalive and NTP-style clock skew calibration.

---

### B. Room Family (`room.*`)

#### `room.join`
- **Direction:** Client → Server
- **Authentication:** Authenticated or Guest
- **Authorization:** User must not be banned from room.
- **Payload:** `{ "room_id": "uuid", "passcode": "optional_hash" }`
- **Source of Truth:** PostgreSQL (Room & Ban records).
- **Broadcast Behavior:** Triggers `participant.joined` broadcast to other room members; sends `room.snapshot` to joining client.

#### `room.snapshot`
- **Direction:** Server → Client
- **Authentication:** Authenticated member
- **Payload:**
  ```json
  {
    "room": {
      "id": "uuid",
      "name": "Friday Chill",
      "host_id": "uuid",
      "version": 42
    },
    "participants": [
      { "user_id": "uuid", "username": "alex", "role": "host", "is_muted": false }
    ],
    "media": {
      "provider": "youtube",
      "media_id": "dQw4w9WgXcQ",
      "title": "Never Gonna Give You Up",
      "playback_status": "PLAYING",
      "base_position_ms": 12400,
      "started_at_server_time": "2026-09-14T10:44:50.000Z",
      "version": 12
    },
    "queue": [
      { "id": "uuid", "provider": "youtube", "media_id": "kJQP7kiw5Fk", "title": "Despacito", "added_by": "uuid" }
    ],
    "livekit_token": "<jwt_grant_for_livekit>"
  }
  ```
- **Source of Truth:** Go in-memory `RoomActor`.

---

### C. Media & Queue Family (`media.*`, `queue.*`)

#### `media.play` / `media.pause` / `media.seek`
- **Direction:** Client → Server & Server → Client
- **Authentication:** Member of room
- **Authorization:** `CanControlMedia(actor, room) == true`
- **Client → Server Payload (`media.seek`):**
  ```json
  { "position_ms": 45000, "expected_version": 12 }
  ```
- **Server → Client Broadcast Payload:**
  ```json
  {
    "playback_status": "PLAYING",
    "base_position_ms": 45000,
    "started_at_server_time": "2026-09-14T10:45:01.200Z",
    "controlled_by": "uuid",
    "version": 13
  }
  ```
- **Stale Command Rejection:** If `expected_version < current_version`, server rejects command with `system.error (STALE_VERSION)`.
- **Persistence:** High-frequency playback updates are not written to DB. Final media item change writes to Postgres media history.

#### `queue.add`
- **Direction:** Client → Server
- **Authorization:** `CanManageQueue(actor, room) == true`
- **Payload:** `{ "provider": "youtube", "media_url": "https://www.youtube.com/watch?v=...", "idempotency_key": "uuid" }`
- **Idempotency:** Server de-duplicates on `idempotency_key` within a 10-minute window.

---

### D. Chat & Reaction Family (`chat.*`, `reaction.*`)

#### `chat.message`
- **Direction:** Client → Server & Server → Client
- **Authorization:** Member of room (not muted/restricted)
- **Rate Limit:** 5 messages per 3 seconds per user.
- **Client Payload:** `{ "content": "Hey everyone!", "client_nonce": "uuid" }`
- **Server Broadcast Payload:**
  ```json
  {
    "message_id": "uuid",
    "user_id": "uuid",
    "username": "alex",
    "content": "Hey everyone!",
    "created_at": "2026-09-14T10:45:02.000Z"
  }
  ```
- **Persistence:** Pushed immediately to Redis/WebSocket broadcast, batched to PostgreSQL every 2 seconds.

#### `reaction.send`
- **Direction:** Client → Server & Server → Client
- **Payload:** `{ "emoji": "🔥" }`
- **Persistence:** Purely ephemeral. Dropped without persistence. Dropped under backpressure if client queue fills.

---

### E. Moderation Family (`moderation.*`)

#### `moderation.kick` / `moderation.ban`
- **Direction:** Client → Server
- **Authorization:** `CanKick(actor, target, room)` / `CanBan(actor, target, room)`
- **Payload:** `{ "target_user_id": "uuid", "reason": "Disruptive behavior" }`
- **Persistence:** Ban written directly to PostgreSQL `bans` table with transaction.
- **Server Action:** Target connection is closed with `system.kicked` event; LiveKit token revoked; Redis presence removed.

---

## 3. Go Protocol Type Definitions

```go
package realtime

import (
    "encoding/json"
    "time"
    "github.com/google/uuid"
)

type EventType string

const (
    EventConnectionAuth      EventType = "connection.auth"
    EventConnectionPong      EventType = "connection.pong"
    EventRoomJoin            EventType = "room.join"
    EventRoomSnapshot        EventType = "room.snapshot"
    EventMediaPlay           EventType = "media.play"
    EventMediaPause          EventType = "media.pause"
    EventMediaSeek           EventType = "media.seek"
    EventQueueAdd            EventType = "queue.add"
    EventChatMessage         EventType = "chat.message"
    EventReactionSend        EventType = "reaction.send"
    EventModerationKick      EventType = "moderation.kick"
    EventSystemError         EventType = "system.error"
)

type Envelope struct {
    Type            EventType       `json:"type"`
    ProtocolVersion int             `json:"protocol_version"`
    EventID         uuid.UUID       `json:"event_id"`
    RoomID          *uuid.UUID      `json:"room_id,omitempty"`
    Sequence        int64           `json:"sequence,omitempty"`
    SentAt          time.Time       `json:"sent_at"`
    Payload         json.RawMessage `json:"payload"`
}
```

---

## 4. TypeScript Discriminated Unions

```typescript
export type ServerEvent =
  | { type: 'connection.authenticated'; payload: AuthenticatedPayload }
  | { type: 'room.snapshot'; payload: RoomSnapshotPayload }
  | { type: 'participant.joined'; payload: ParticipantJoinedPayload }
  | { type: 'participant.left'; payload: ParticipantLeftPayload }
  | { type: 'media.state'; payload: MediaStatePayload }
  | { type: 'queue.updated'; payload: QueueUpdatedPayload }
  | { type: 'chat.message'; payload: ChatMessagePayload }
  | { type: 'reaction.send'; payload: ReactionPayload }
  | { type: 'system.error'; payload: ErrorPayload };

export interface Envelope<T = unknown> {
  type: string;
  protocol_version: number;
  event_id: string;
  room_id?: string;
  sequence?: number;
  sent_at: string;
  payload: T;
}
```
