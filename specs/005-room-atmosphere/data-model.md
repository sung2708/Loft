# Data Model: Room Atmosphere

## Room Appearance

Durable shared value embedded in the existing Room entity.

| Field | Logical type | Rules |
|---|---|---|
| `atmosphere` | enum | `minimal`, `ambient`, `focus`, `party`; default/fallback `ambient` |
| `accent` | enum | `blue`, `purple`, `green`, `orange`, `rose`; default/fallback `blue` |
| `adaptive_media_background` | boolean | Default `true`; controls eligibility, not guaranteed derivation success |
| `version` | positive integer | Existing room version; increments atomically on committed appearance mutation |

Relationship: exactly one Room Appearance belongs to one persistent Room. It shares the Room lifecycle and is returned as part of the room's public semantic state. It contains no CSS, URLs, image data, secrets, or participant preferences.

## Application Color Mode

Participant-local preference with values `light`, `dark`, or `system`. It remains outside Room Appearance and is neither accepted by room mutations nor propagated to peers.

## Adaptive Media Treatment

Ephemeral frontend projection keyed by the current shared-media identity.

| Field | Logical type | Rules |
|---|---|---|
| `media_identity` | provider video identifier | Must match the current authoritative shared-media item |
| `status` | enum | `idle`, `loading`, `ready`, `fallback` |
| `palette` | controlled presentation mapping | Derived locally; never accepted as shared room state |
| `generation` | monotonic local token | Prevents stale asynchronous work replacing a newer media result |

This value is disposable on media change, room leave, failure, or no active media. It is not written to PostgreSQL or Redis.

## Validation

- All shared values are closed enums/booleans.
- Missing legacy values normalize to Ambient + Blue + adaptive enabled.
- Unknown incoming/stored enum values are rejected on mutation and safely normalized on read.
- A mutation requires current-host authority and the expected current Room version.
- A successful mutation atomically writes all appearance fields and increments Room version once.
- A rejected/conflicting mutation performs no partial update.

## State transitions

### Authoritative appearance

`snapshot/current → host mutation pending → committed(new version) → event projection`

- Permission/validation/conflict failure returns to `snapshot/current` unchanged.
- Host transfer does not alter appearance.
- Empty room does not clear appearance.
- Reconnect/late join begins from the latest snapshot value.

### Adaptive treatment

`idle → loading → ready`

Fallback paths: `loading → fallback`, `ready → fallback` on media end, or any state → `idle` on room teardown. A newer generation invalidates all older work.
