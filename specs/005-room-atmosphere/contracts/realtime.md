# Realtime Contract: Room Appearance

All envelopes retain the existing protocol version and room identifier conventions. Payloads contain semantic values only.

## Client command: `room.appearance.update`

```json
{
  "type": "room.appearance.update",
  "version": 1,
  "room_id": "public-or-internal-room-id",
  "payload": {
    "atmosphere": "ambient",
    "accent": "orange",
    "adaptive_media_background": true,
    "expected_version": 7
  }
}
```

Rules:

- Sender identity comes only from the authenticated connection.
- Current-host authority is required.
- Enum values must match the closed domain allowlists.
- `expected_version` must match the current durable Room version.
- The durable commit completes before success is published.

## Server event: `room.appearance.updated`

```json
{
  "type": "room.appearance.updated",
  "version": 1,
  "room_id": "public-or-internal-room-id",
  "payload": {
    "atmosphere": "ambient",
    "accent": "orange",
    "adaptive_media_background": true,
    "version": 8
  }
}
```

The event carries the complete committed appearance. Consumers ignore older room versions and snapshots remain authoritative.

## Snapshot extension

`room.snapshot.payload.room` and room API representations add:

```json
{
  "atmosphere": "ambient",
  "accent": "blue",
  "adaptive_media_background": true
}
```

No derived palette, artwork URL/blob, CSS instruction, personal color mode, or media frame appears in snapshot/event state.

## Errors

| Code | Meaning |
|---|---|
| `INVALID_PAYLOAD` | Missing/wrongly typed payload |
| `INVALID_ROOM_APPEARANCE` | Unsupported atmosphere/accent/value |
| `ROOM_COMMAND_REJECTED` | Sender is not the current authorized host |
| `ROOM_VERSION_CONFLICT` | Expected room version is stale |
| `INTERNAL_ERROR` | Durable mutation failed; current appearance remains authoritative |

Errors follow the existing error envelope and never echo arbitrary styling input.
