# Data Model: Social Reactions & Presence

## Ownership Matrix

| State | Authority | Recovery | Persistence |
|---|---|---|---|
| Participant membership/generation | Go room authority | Snapshot + Redis presence lease | Ephemeral |
| Raised Hand | Existing participant state | Snapshot + presence reconciliation | Ephemeral |
| Reaction/Wave | Accepted server fact | Not replayed | None |
| Speaking/mic/camera/share | LiveKit | Current LiveKit participant/tracks | Ephemeral |
| SFX preferences | Local browser preference | Read on client bootstrap | Browser-local |
| SFX playback | Frontend manager | None | None |

## ReactionKind

Closed enum using the existing wire representation: `❤️|😂|🔥|👏|😭`.

Validation:
- Exactly one supported value.
- The closed glyph value is rendered as text with a separate localized accessibility label; no arbitrary text/HTML/URL.
- Legacy 👍 and 🎉 are not offered or accepted by the final SPEC 003 client/server contract.

## SocialSignal

Ephemeral accepted fact for Reaction or Wave.

| Field | Meaning |
|---|---|
| event_id | Unique envelope fact identifier |
| room_id | Current room scope |
| connection_id | Server-derived participant connection |
| display_name | Server-derived presentation name |
| kind | Reaction enum or Wave |
| emitted_at | Server timestamp used for bounded local expiry, not ordering durable state |

Rules:
- Never stored as chat or in PostgreSQL.
- Never included in a recovery snapshot.
- May be dropped/coalesced for slow consumers.
- Frontend holds at most 6 visible groups and expires each within 5 seconds.

## ParticipantSocialState

An extension of the existing participant entity.

| Field | Type | Rule |
|---|---|---|
| raised_hand | boolean | Defaults false; self-controlled |
| social_version | unsigned integer | Monotonic for accepted state changes |
| connection_id | existing identifier | Must match current admitted generation |
| generation | existing/current generation | Fences replaced sockets |

State transitions:

```text
LOWERED --self raise--> RAISED
RAISED  --self lower--> LOWERED
RAISED  --reconnect within grace--> RAISED
ANY     --stale command--> unchanged
ANY     --true leave / grace expiry / kick / ban / room empty--> removed (implicit LOWERED)
```

Invariants:
- One state per logical participant, not a parallel hand map.
- Repeated set-to-current commands are idempotent and do not create duplicate visible facts.
- Newer `social_version` wins across instances; generation/connection validates ownership.
- Redis presence representation carries current participant social fields for remote snapshots.
- Redis refresh/network I/O occurs after releasing room locks.

## PresenceSession

Uses the existing identity, tab session, connection ID, generation, join time, and reconnect grace.

Social additions:
- Same-tab valid replacement inherits current Raised Hand.
- A different tab remains governed by existing duplicate-session rules.
- A stale connection cannot mutate or clear newer social state.
- True departure removes participant social state exactly once.

## SfxPreference

| Field | Type | Default | Range |
|---|---|---|---|
| sound_effects_enabled | boolean | true | boolean |
| room_sounds_enabled | boolean | true | boolean |
| volume | integer | 60 | 0–100 |
| schema_version | integer | 1 | fixed current version |

Rules:
- One centralized browser key; invalid data falls back safely.
- Preference changes apply immediately.
- Does not alter LiveKit or shared-media volume.
- A volume of zero is silent without changing category toggles.

## SfxCue

Closed local manifest identifier grouped by policy:

- UI: mute, unmute, camera-on, camera-off, screen-start, screen-end, error.
- Room: room-enter, participant-join, participant-leave, reconnect, disconnect, remove-from-room, host-transfer, raise-hand.
- Silent: reactions and chat.

Each manifest item defines a fixed local asset, category, gain adjustment, and optional concurrency
group. Arbitrary server/client-provided asset URLs and cue identifiers are rejected.

## Bounded Presentation

- Reaction groups: maximum 6.
- Count shown per group: bounded (current implementation caps at 99).
- Timers: one shared expiry scheduler for visible groups, not one unowned loop per event.
- SFX voices: fixed small pool; excess low-priority cues are dropped.
- Unmount resets transient stores and stops owned playback/listeners.

## Durable Schema Impact

None. No PostgreSQL table, column, index, or migration is required.
