# Room Access Contracts

These contracts describe the user-facing/backend boundaries required by SPEC 001. Exact route,
package, and DTO names may follow the existing repository conventions during implementation, but the
security and response semantics are normative.

## Room Preview / Resolve

Existing resolution behavior remains compatible for public short codes, legacy invite codes, and
accepted UUID links.

Successful preview returns only safe metadata:

```json
{
  "room": {
    "id": "internal-compatible-id",
    "slug": "123456",
    "name": "Late Night Coding",
    "allow_guests": true,
    "password_required": true,
    "max_participants": 12,
    "is_locked": false
  }
}
```

The response MUST NOT contain a password, verifier, authorization token, or password-derived secret.

## Guest Session / Admission

The existing guest-session boundary is extended with an optional password input:

```json
{
  "display_name": "Minh",
  "password": "user-entered-secret"
}
```

Normative outcomes:

| Condition | User-facing result |
|---|---|
| Public and allowed | Issue the existing room-scoped guest credential |
| Password missing when required | `PASSWORD_REQUIRED`, “Enter the room password to join.” |
| Password incorrect | `INVALID_ROOM_PASSWORD`, “That password doesn't look right. Try again.” |
| Temporary failed-attempt cooldown | `RATE_LIMITED`, calm retry-after guidance without internal details |
| Locked | `ROOM_LOCKED`, “This room is locked right now.” |
| Guest access disabled | `ROOM_ACCESS_DENIED`, friendly access explanation |
| Room absent/unavailable | `ROOM_NOT_FOUND` or unavailable equivalent, “This room isn't available.” |

Password failure responses MUST be indistinguishable enough not to disclose secret material or create
an alternate access path. A credential is issued only after all applicable policy checks pass.

## Owner Room Settings

The authorized owner can submit a versioned mutation containing only in-scope settings:

```json
{
  "expected_version": 4,
  "name": "Late Night Coding",
  "allow_guests": true,
  "password": "new-secret-or-empty",
  "password_enabled": true,
  "locked": false
}
```

The implementation may split this into smaller commands, but each accepted mutation MUST:

1. Verify owner authority server-side.
2. Validate the complete resulting policy.
3. Reject stale `expected_version` without overwriting newer policy.
4. Persist the durable change before announcing it to other instances/clients.
5. Return the new safe policy and version without returning password material.

## Realtime Policy Update

When a connected room's policy changes, clients receive a typed policy update or the next authoritative
snapshot. The event contains safe fields only:

```json
{
  "type": "room.access_changed",
  "version": 1,
  "room_id": "room-id",
  "payload": {
    "allow_guests": true,
    "password_required": true,
    "is_locked": false,
    "version": 5
  }
}
```

Existing connected participants are not disconnected solely because the password changes. New joins,
reconnects, and LiveKit token requests use the current authoritative admission policy.

## Lifecycle

The existing owner-only explicit delete contract remains. Delete succeeds only after authorization and
active-room deletion coordination; later resolve, join, reconnect, and media-token requests treat the
room as unavailable. Participant leave, browser close, and in-memory eviction are not delete actions.
