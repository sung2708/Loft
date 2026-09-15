# Authentication, Identity & Permissions Architecture — Loft

This document specifies user and guest identity verification, server-side authorization evaluation, host governance, and permission policies for Loft.

---

## 1. Identity Separation: Authenticated Users vs Guests

Loft supports instant, frictionless guest entry alongside permanent user accounts:

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

The host's `participant.kick` command writes a durable room ban first, then closes the participant's WebSocket and asks LiveKit to remove the active media participant. Loft rejects future WebSocket admission and LiveKit token issuance for the banned identity. If the LiveKit management call fails, the ban and WebSocket eviction still stand, but the active SFU connection may remain until LiveKit disconnects it.

LiveKit Cloud revokes existing tokens on `RemoveParticipant`; this implementation supplies an explicit `revoke_token_ts`. Self-hosted LiveKit does not revoke an already issued JWT when a participant is removed. Such a cached token can be retried directly against the SFU until it expires, even though Loft will not issue a fresh one. See [LiveKit participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/) and [token revocation limits](https://docs.livekit.io/frontends/reference/tokens-grants/).
