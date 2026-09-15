# Contract: Social Realtime Extensions

All messages retain the existing envelope version 1:

```json
{"type":"reaction.send","version":1,"event_id":"uuid","room_id":"room-uuid","payload":{}}
```

Identity, room, display name, connection ID, generation, and server timestamps are derived or
validated by the server. Unknown fields do not grant authority.

## Reaction

### `reaction.send` — Client → Server

```json
{"emoji":"❤️"}
```

`emoji` uses the existing wire field and is exactly one of `❤️|😂|🔥|👏|😭`. This avoids a
protocol rename while tightening the final product set.

### `reaction.sent` — Server → Room

```json
{
  "connection_id":"current-connection",
  "display_name":"Linh",
  "emoji":"❤️",
  "emitted_at":"2026-09-15T05:00:00Z"
}
```

Delivery is ephemeral/best effort. It changes no room version, is absent from snapshots, and may be
dropped/coalesced under backpressure.

## Wave

### `wave.send` — Client → Server

```json
{}
```

No target or actor identity is accepted.

### `wave.sent` — Server → Room

```json
{
  "connection_id":"current-connection",
  "display_name":"Minh",
  "emitted_at":"2026-09-15T05:00:00Z"
}
```

Wave shares bounded social rate policy and ephemeral delivery with reactions but remains a distinct
domain fact for copy and accessibility.

## Raise Hand

### `participant.hand.set` — Client → Server

```json
{"raised":true,"expected_social_version":3}
```

Rules:
- Actor is the admitted connection; no target field is accepted.
- Expected version must match current participant social version.
- Setting the current value is idempotent.
- Replaced, stale, removed, kicked, or banned sessions cannot mutate.

### `participant.hand_changed` — Server → Room

```json
{
  "connection_id":"current-connection",
  "identity_id":"server-derived-id",
  "generation":2,
  "raised":true,
  "social_version":4
}
```

This is an authoritative current-state fact. Remote nodes and clients apply only a newer valid
version for the same logical participant/generation.

## Snapshot Addition

Every participant in `room.snapshot.payload.participants` and `self` gains optional rolling-deploy fields:

```json
{"raised_hand":false,"social_version":0}
```

Missing fields default to false/zero. Reactions and Waves never appear in snapshot history.

## Redis Presence Representation

The existing presence lease's typed participant object carries `raised_hand` and
`social_version`. A successful hand change updates local authority first, releases the room lock,
then refreshes/publishes through existing bounded Redis paths. Redis is not durable authority.

## Rate and Backpressure Semantics

- Reaction and Wave use the existing per-identity distributed social limiter and room burst guard.
- Exact rates remain configurable implementation policy; existing reaction behavior is the baseline.
- `REACTION_RATE_LIMITED` and `WAVE_RATE_LIMITED` are recoverable.
- Social ephemeral facts may be dropped/coalesced before authoritative hand/snapshot facts.
- Saturated outbound queues retain existing CloseNow slow-consumer policy.

## Error Contract

| Code | Meaning |
|---|---|
| `INVALID_REACTION` | Value is outside the closed set |
| `REACTION_RATE_LIMITED` | Participant or room allowance exhausted |
| `WAVE_RATE_LIMITED` | Wave/social allowance exhausted |
| `SOCIAL_STATE_STALE` | Expected social version/generation is obsolete |
| `SOCIAL_ACTION_DENIED` | Connection is not authorized/current/admitted |
| `INVALID_PAYLOAD` | Payload shape is invalid |

Errors contain neutral user-safe messages and no credentials or infrastructure details.

## Frontend Presentation Contract

- Server facts never contain SFX cue IDs, asset paths, coordinates, HTML, or animation instructions.
- Frontend maps each allowed glyph to a localized accessibility label.
- Domain facts may trigger local policy decisions (for example participant join), never mandatory playback.
- Reaction/chat remain silent.
- Reduced motion preserves content/state while suppressing nonessential spatial motion.

## Compatibility Rules

- Envelope version remains 1.
- Older clients may ignore Wave/hand events and unknown optional participant fields.
- New clients default absent social fields for older servers.
- Existing reaction event and `emoji` field remain stable; implementation tests rolling deployment
  where older clients may still attempt the retired 👍 or 🎉 values and receive a neutral rejection.
- Existing `loft.*` internal keys and protocol namespaces are not renamed by this feature.
