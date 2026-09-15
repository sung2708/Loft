# Research: Social Reactions & Presence

## Existing Architecture Audit

- One envelope-v1 WebSocket path and one frontend realtime client already handle rooms.
- Go room state owns membership; Redis leases coordinate remote presence. Same-tab replacement and
  stale-close fencing already exist.
- Outbound queues are fixed at 64 and broadcasts are non-blocking.
- Reactions already have typed events, participant/room limits, distributed limiting, Pub/Sub,
  frontend grouping, and expiry.
- LiveKit drives speaking, microphone, camera, and screen-share presentation.
- No runtime Wave, Raise Hand, automatic AFK, or SFX manager exists. Fifteen root WAV candidates are
  unintegrated and not assumed production-approved.

## Decisions

### 1. Extend reactions

**Decision**: Keep `reaction.send` / `reaction.sent`, use only ❤️, 😂, 🔥, 👏, 😭, and preserve
bounded ephemeral fanout/aggregation.

**Rationale**: Existing architecture already satisfies most safety boundaries.

**Alternatives considered**: Generic social event (weaker typing); arbitrary emoji (validation and abuse risk).

### 2. Distinct room-level Wave

**Decision**: Add `wave.send` / `wave.sent`, room-level only, sharing social limits and ephemeral delivery.

**Rationale**: Wave has distinct meaning; direct targeting adds stale-target and notification complexity.

**Alternatives considered**: Encode 👋 as a reaction; targeted Wave. Both are deferred.

### 3. Raise Hand in participant state

**Decision**: Add `raised_hand` and monotonic `social_version` to the existing participant. The
owning authority updates it, emits a typed fact, then refreshes presence after releasing the lock.

**Rationale**: Snapshot, remote merge, reconnect, kick, leave, and cleanup then share one lifecycle.

**Alternatives considered**: Separate hand map (duplicate state); PostgreSQL (unneeded durability);
event replay (contradicts snapshot recovery).

### 4. Fence stale changes

**Decision**: Server facts include connection identity/generation and social version. Newer version
wins; stable connection tie-break resolves equal versions. Replaced sockets cannot mutate.

**Rationale**: Pub/Sub order is not guaranteed and reconnect races are regression-sensitive.

**Alternatives considered**: Arrival order and wall-clock timestamps; both can diverge.

### 5. Reuse distributed infrastructure

**Decision**: Reactions/Wave use the existing distributed limiter and room Pub/Sub. Local bounded
fallback remains during Redis failure. Raise Hand uses normal state events and presence reconciliation.

**Rationale**: Avoids new Redis clients, subscriptions, durable dependencies, and goroutines.

**Alternatives considered**: PostgreSQL bus; per-room subscriptions. Both violate established boundaries.

### 6. No automatic AFK

**Decision**: Do not implement AFK/Away in SPEC 003.

**Rationale**: Visibility, silence, mute, camera-off, and inactivity cannot reliably distinguish listening.

**Alternatives considered**: Visibility timer and manual Away; manual Away may be a later feature.

### 7. Frontend-only SFX

**Decision**: One manager/store uses a fixed manifest, bounded concurrent voices, shared volume,
separate UI/room toggles, and a user-gesture unlock attempt. Blocked/missing/over-budget playback is harmless.

**Rationale**: SFX must not affect WebSocket, LiveKit, or shared-media audio.

**Alternatives considered**: Server sound commands, per-sound toggles, unbounded `new Audio`; rejected.

### 8. Validate assets before integration

**Decision**: Review WAV ownership, peaks, audible duration, silence, encoding, and loudness. Move
only approved optimized derivatives to `frontend/public/sfx`.

**Rationale**: Root files are not evidence of production suitability.

**Alternatives considered**: Ship all unchanged or generate replacements without authorization; rejected.

### 9. Stage-first accessible presentation

**Decision**: Use one compact social popover in Call Dock, a bounded Stage overlay, and a hand badge
on existing ParticipantTile. Support labels, pressed/expanded state, dismissal/focus return, and reduced motion.

**Rationale**: Preserves responsive Stage and stable LiveKit track identity.

**Alternatives considered**: Permanent toolbar, tile reordering, full-screen effects; rejected.

### 10. Compatibility

**Decision**: No database migration. Keep existing internal `loft.*` keys. A new centralized
current-brand SFX key is safe because no prior SFX preference exists. New clients default absent
participant fields; old clients ignore unknown new events.

**Rationale**: Supports rolling deployment and preserves existing user state.

**Alternatives considered**: Renaming existing protocol/storage identifiers; unrelated compatibility risk.
