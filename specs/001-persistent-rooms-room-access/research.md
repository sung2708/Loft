# Research: Persistent Rooms & Room Access

**Feature**: `001-persistent-rooms-room-access`
**Date**: 2026-09-15

## Current Repository Findings

- PostgreSQL already owns durable `rooms`, `room_members`, `messages`, and room governance data.
  `rooms` already has a stable UUID, public short code, legacy invite code, owner, name, guest flag,
  lock state, version, and timestamps.
- Authenticated room creation, owner listing, owner-only deletion, guest sessions, room resolution,
  lock checks, LiveKit admission, and snapshot reconnect already exist. The feature must extend these
  paths rather than introduce parallel room abstractions.
- Current guest admission accepts a display name and checks `allow_guests` and `is_locked`, but has
  no password policy. Current `Room` and preview types do not expose a password-required indicator.
- Current room deletion is permanent, owner-only, explicitly confirmed in the existing UI, and
  guarded against active/deleting room races. Use that existing lifecycle for SPEC 001 rather than
  adding archive semantics.
- Existing room state documentation distinguishes durable room metadata from ephemeral presence,
  media, queue, and client state. The ten-minute in-memory eviction after the last participant leaves
  must not delete durable room metadata.
- Existing distributed rate limiting and Redis fallback can be extended for failed password attempts;
  the exact key and threshold remain implementation details for tasks.

## Decisions

### Decision: Extend the existing room model and admission pipeline

**Rationale**: The repository already has a coherent source-of-truth boundary and owner lifecycle.
Adding access-policy fields and centralized domain evaluation preserves compatibility and avoids a
second room service.

**Alternatives considered**: Replacing the room model or introducing a separate persistent-room
service was rejected because it violates the constitution's `EXTEND > REFACTOR > REPLACE` policy and
would risk existing realtime/media behavior.

### Decision: Store only a one-way password verifier and expose only a boolean policy

**Rationale**: The room needs durable password protection without putting secrets in invite URLs,
room snapshots, logs, or client state. The preview and snapshot should expose only whether a password
is required, never the verifier or password material.

**Alternatives considered**: Plaintext storage and reversible encryption were rejected because a room
password is authorization material and must remain unrecoverable if durable data is read.

### Decision: Verify password before issuing a guest authorization credential

**Rationale**: Existing guest credentials are room-scoped and later admission checks their scope.
Issuing a credential before password verification would create a bypass unless every downstream path
also carried an unverified state. Password verification belongs at the guest-session boundary.

**Alternatives considered**: Putting the password in a URL or trusting a client-side verified flag was
rejected because neither establishes server authority.

### Decision: Reuse explicit permanent deletion for SPEC 001

**Rationale**: The repository already has `DELETE /rooms/{roomID}`, owner authorization, active-room
deletion guarding, confirmation UI, and cascading durable deletion. This satisfies the required
explicit lifecycle distinction without introducing an unrequested archive state.

**Alternatives considered**: Adding archive/restore was deferred because it changes retention,
discovery, and authorization semantics beyond the core access upgrade.

### Decision: Recent Rooms remains secondary

**Rationale**: The current application already has lightweight room-return surfaces, while anonymous
server-side history would conflict with guest-first privacy. Owner room listing is part of the core;
recent-room history may use existing browser-local behavior later and must not block planning or
implementation of persistent access.

**Alternatives considered**: Introducing guest accounts or durable anonymous visit records was rejected
because it adds identity and privacy scope for a non-core convenience.

### Decision: Treat access policy changes as durable versioned mutations

**Rationale**: Lock already uses owner authorization and optimistic versioning. Name and password
policy changes need the same compare-and-swap behavior so two instances cannot silently overwrite one
another, and active rooms can receive a canonical policy update without I/O under realtime locks.

**Alternatives considered**: Last-write-wins updates without a version check were rejected because
they permit stale owners to overwrite newer security policy.

### Decision: Fail closed for uncertain access, fail soft only for non-authoritative coordination

**Rationale**: PostgreSQL is the durable source of room access policy. A database or authorization
uncertainty must not grant entry. Redis may use the existing bounded fallback for rate limiting, but
the fallback must not bypass password verification or durable policy.

**Alternatives considered**: Granting access during policy-store failure was rejected as a security
violation; requiring Redis for every single-node join was rejected because the existing architecture
already supports bounded local fallback.

## Research Tasks Resolved

- Existing room persistence and lifecycle: resolved by `000001_mvp`, `000002_governance`,
  `000003_short_room_codes`, store methods, HTTP handlers, and `DeleteRoomDialog`.
- Existing reconnect and presence boundary: resolved by `docs/room-state.md` and
  `docs/reconnect-recovery.md`; durable rooms survive ephemeral room-state eviction.
- Existing multi-instance coordination: resolved by `docs/redis.md`, `redis_admission.go`, and the
  distributed limiter; access policy must be read from PostgreSQL and changes fan out through the
  existing room authority/event path.
- Existing compatibility constraints: resolved by README, release notes, current API types, and
  server tests; UUID and legacy invite resolution remain accepted.

## Remaining Planning Choices

The following are deliberately implementation-level and belong in tasks after this design: password
hashing package/configuration, exact failed-attempt threshold/window and identity key, migration names,
HTTP request/response DTO names, realtime event names, and precise UI component placement.
