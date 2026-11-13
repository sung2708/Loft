# Authentication, Identity & Permissions Architecture — Mingly

This document specifies user and guest identity verification, server-side authorization evaluation, host governance, and permission policies for Mingly.

---

## 1. Identity Separation: Authenticated Users vs Guests

Mingly supports instant, frictionless guest entry alongside permanent user accounts:

```
                  ┌──────────────────────────────────────────────┐
                  │             Incoming Connection              │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼ (Has Supabase Bearer JWT)                     ▼ (Has Guest Token)
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │     AUTHENTICATED USER    │                   │       GUEST IDENTITY      │
   ├───────────────────────────┤                   ├───────────────────────────┤
   │ • Issued by Supabase Auth │                   │ • Ephemeral room-scoped   │
   │ • Backed by `profiles`    │                   │ • HMAC-SHA256 signed by Go│
   │ • Durable user UUID       │                   │ • 12-hour expiration      │
   │ • Can create/own rooms    │                   │ • Cannot own rooms        │
   │ • Role: host or member    │                   │ • Role: guest             │
   └───────────────────────────┘                   └───────────────────────────┘
```

---

## 2. Server-Authoritative Capability Model (Zero Client Authority)

**Cardinal Invariant**: The frontend is purely a presentation layer. It never decides authorization. Every privileged WebSocket command and REST API call is evaluated server-side against domain policies:

```go
package domain

// Centralized Authorization Evaluators
func CanJoin(room Room, identity Identity) bool {
    return identity.Type == IdentityUser || 
          (identity.Type == IdentityGuest && room.AllowGuests && identity.RoomID == room.ID)
}

func CanControlMedia(room Room, identity Identity) bool {
    // Only the authenticated room owner can control media timeline
    return identity.Type == IdentityUser && room.OwnerID != "" && identity.ID == room.OwnerID
}

func CanManageQueue(room Room, identity Identity) bool {
    // Any admitted participant (including guests) can add/reorder queue
    return CanJoin(room, identity)
}

func CanChangeSettings(room Room, identity Identity) bool {
    return CanControlMedia(room, identity)
}

func CanKick(room Room, identity Identity) bool {
    return CanControlMedia(room, identity)
}

func CanDeleteRoom(room Room, identity Identity) bool {
    return identity.Type == IdentityUser && identity.ID == room.OwnerID
}
```

The hub also rejects a kick targeting the actor or another host. Admission separately checks `rooms.is_locked` for new guests and the PostgreSQL `room_bans` table for every identity. A valid identity alone does not grant entry to a locked room or override a ban.

---

## 3. Action Capability Matrix (MVP 2)

| Action | Protocol Event / API | Host (Owner) | Authenticated Member | Guest |
| :--- | :--- | :---: | :---: | :---: |
| **Join Room** | `connection.auth` | Yes | Yes | Yes (if `allow_guests` and room unlocked) |
| **Send Chat** | `chat.send` | Yes | Yes | Yes |
| **Send Reaction** | `reaction.send` | Yes | Yes | Yes |
| **Add to Queue** | `queue.add` | Yes | Yes | Yes |
| **Remove from Queue** | `queue.remove` | Yes | Yes | Yes |
| **Reorder Queue** | `queue.reorder` | Yes | Yes | Yes |
| **Play / Pause / Seek** | `media.play/pause/seek` | **Yes** | No | No |
| **Select / Skip Track** | `queue.select/next` | **Yes** | No | No |
| **Clear Queue** | `queue.clear` | **Yes** | No | No |
| **Lock Room** | `room.lock` | **Yes** | No | No |
| **Kick Participant** | `participant.kick` | **Yes** | No | No |
| **Delete Room** | `DELETE /rooms/{id}` | **Yes** | No | No |

---

## 4. Host Disconnect & Presence Policy

In MVP 2, room ownership is tied durably to the authenticated creator (`room.owner_id` in PostgreSQL):

1. **Transient Disconnect**:
   - If the room host drops their connection (WiFi blip, laptop sleep), the room retains their participant for a 15-second reconnect grace period.
   - Media playback continues along its canonical timeline (or pauses if paused).
   - Non-host members can continue chatting and adding queue items.
2. **Rejoin**:
   - When the owner reconnects, the server recognizes `identity.ID == room.OwnerID` and assigns the `host` role in the room snapshot. Room ownership is not transferred to another participant after the grace period.
3. **Empty Room Eviction**:
   - If all participants (including the host) leave, an in-memory 10-minute eviction timer begins.
   - If no one rejoins within 10 minutes, the in-memory room state is evicted. Durable room metadata and message history remain safely in PostgreSQL.

## 5. Kick Enforcement Across WebSocket and LiveKit

The host's `participant.kick` command writes a durable room ban first, then closes the participant's WebSocket and asks LiveKit to remove the active media participant. Mingly rejects future WebSocket admission and LiveKit token issuance for the banned identity. If the LiveKit management call fails, the ban and WebSocket eviction still stand, but the active SFU connection may remain until LiveKit disconnects it.

LiveKit Cloud revokes existing tokens on `RemoveParticipant`; this implementation supplies an explicit `revoke_token_ts`. Self-hosted LiveKit does not revoke an already issued JWT when a participant is removed. Such a cached token can be retried directly against the SFU until it expires, even though Mingly will not issue a fresh one. See [LiveKit participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/) and [token revocation limits](https://docs.livekit.io/frontends/reference/tokens-grants/).

## 6. Global Admin Access

The `/api/v1/admin/*` endpoints require a valid Supabase user JWT and a matching user UUID in the backend-only `ADMIN_USER_IDS` allowlist. An empty allowlist disables access. Admin responses expose profile names, IDs, account creation dates, room ownership, and room access settings; they do not expose emails, messages, or room password verifiers. The Go API enforces authorization on every request.

Every admin request passes one gate (`adminGate`): authentication, the allowlist (denials are logged with the user ID and path), a per-admin budget (240 reads and 30 writes a minute, shared through Redis), and, when `ADMIN_REQUIRE_MFA=true`, an `aal2` JWT. A session without the second factor gets `ADMIN_MFA_REQUIRED`, and the admin page runs Supabase TOTP enrolment or verification in place rather than signing out.

Admins also see the report queue (`/admin/reports`), per-account history (`/admin/users/{id}`: last active, rooms created and joined, messages sent, reports and audit entries), and can filter and export the audit log as CSV (newest 5,000 rows; free-text cells are prefixed to block spreadsheet formulas). Closing a report is one conditional update plus an audit row in the same transaction, so two admins cannot both resolve it.

### Reports and account self-service

- Any admitted participant, guest or member, can report another participant or the room (`POST /rooms/{id}/reports`). One open report per reporter and target; 10 an hour per identity. Reports have no foreign keys and outlive the room and both accounts.
- `PATCH /users/me` sets a custom display name or hides the avatar. The choice lives in `profiles` because Google sign-in overwrites Supabase `user_metadata`; the JWT verifier applies it (fresh lookup, omits avatar on lookup failure), so REST and WebSocket agree.
- `POST /users/me/deletion` (body `{"confirm":"DELETE"}`) schedules deletion after 14 days; `DELETE /users/me/deletion` cancels. A sweeper (`internal/accounts`) purges due accounts: it fences every owned room through the realtime hub, postpones by an hour while any is in use, and waits while the account is suspended so deletion cannot be used to escape a ban. The purge deletes `auth.users` (cascading to the profile and sessions); messages in other people's rooms are kept as "Deleted member".
- `GET /users/me/export` returns profile, rooms, the newest 10,000 sent messages, call ratings and recent rooms as JSON (4 an hour).
- A suspended member's `ACCOUNT_SUSPENDED` error carries the reason category and end date, never the admin note.


Admin overview counts come from PostgreSQL, including accounts and rooms created in the last seven days. `open_rooms` means rooms without a durable ending record; it does not indicate connected participants. Room lists support `status=open|ended|moderated` and an exact `owner` UUID alongside search and pagination.

`POST /api/v1/admin/rooms/{roomID}/end` allows an allowlisted administrator to end another user's room. It uses the same durable ending and connection cleanup path as owner termination: persist first, disconnect second, retain messages and room records. Repeating the request retries cleanup safely. A `ROOM_END_MEDIA_PENDING` response means admission is already closed but call cleanup needs retrying. Successful persistence emits an `admin ended room` structured log with actor and room IDs; this log is not a durable audit ledger.


Admin endings require JSON `{ "reason": "policy", "note": "Documented basis for the decision" }`. Supported reasons are `illegal` (suspected illegal activity, not a legal determination), `policy`, `safety`, `spam`, and `other`. Notes are trimmed and require 10–1000 characters. Migration 000015 must be applied before deploying this version.

The decision (actor, reason, note, timestamp) and room ending are recorded atomically in PostgreSQL. A unique room ID keeps the first decision immutable across retries and concurrent administrators. Admin room responses include this record; `status=moderated` finds rooms with a decision. The record survives subsequent room/account deletion and remains searchable by room UUID in the admin list (including `status=moderated`). Deleted entries expose the retained decision and ID, not deleted room/owner details, and cannot trigger cleanup. It is inaccessible through public room responses. Owner-ended rooms can still receive a moderation decision. Notes should describe the observed conduct and policy basis without storing secrets or unnecessary personal data. This flow does not record media, ban accounts, or adjudicate legal violations.

Room closure also serializes against chat writes using the room row lock. The server rechecks durable room admission every 15 seconds per connected socket; a missing/ended room terminates local participants even when the bus event or client heartbeat is absent. An unavailable check closes the socket so normal authenticated reconnect recovery must succeed before further use.
