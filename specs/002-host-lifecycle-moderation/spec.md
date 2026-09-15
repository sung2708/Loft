# Feature Specification: Host Lifecycle & Moderation

**Feature Branch**: `002-host-lifecycle-moderation`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: Create the second MVP3 feature specification for host lifecycle and moderation in the existing Loft realtime application.

## User Scenarios & Testing

### User Story 1 - Reliable Host Authority (Priority: P1)

As the current room host, I want host-only actions to remain authoritative through transfers, temporary disconnects, and genuine departure so that the room stays governable without surprising authority changes.

**Why this priority**: Host authority protects every other moderation and governance action.

**Independent Test**: Transfer host authority, disconnect the host briefly, then let the host leave beyond the reconnect grace period and verify one deterministic successor is observed by all participants.

**Acceptance Scenarios**:

1. **Given** Linh is the current host, **when** Linh transfers authority to Minh, **then** Minh becomes the only authoritative host and Linh's stale client state cannot perform host-only actions.
2. **Given** the host briefly disconnects, **when** the host reconnects within the existing grace period, **then** host authority is restored without failover or duplicate presence.
3. **Given** the host does not reconnect before the grace period expires, **when** eligible participants remain, **then** exactly one deterministic successor becomes host and all instances converge on that result.
4. **Given** the durable owner returns after failover, **when** another participant is current host, **then** ownership/settings authority and realtime host authority remain distinct and the owner does not silently reclaim host authority.

### User Story 2 - Safe Participant Moderation (Priority: P1)

As the current host, I want to remove a participant and, where supported, apply a temporary room ban so that harmful behavior can be stopped without creating permanent account-wide punishment.

**Why this priority**: Existing kick behavior must remain reliable under reconnects, races, and multiple backend instances.

**Independent Test**: Kick a participant, attempt immediate reconnect, repeat the action, and execute the same action from a second backend instance.

**Acceptance Scenarios**:

1. **Given** Linh is host and Minh is present, **when** Linh removes Minh, **then** Minh receives a clear removal state, leaves the room, and cannot be restored by stale reconnect cleanup.
2. **Given** Minh is not host, **when** Minh sends an equivalent moderation command directly, **then** the server denies it and the room remains unchanged.
3. **Given** a participant is temporarily banned, **when** they attempt to rejoin before expiry, **then** admission is denied; after expiry, normal access policy applies again.
4. **Given** a kick targets a participant who already left or is the host, **when** the action is evaluated, **then** it is rejected safely without duplicate destructive effects.

### User Story 3 - Lock and Reconnect Consistency (Priority: P1)

As a room participant, I want lock, kick, reconnect, and snapshot behavior to agree so that a network interruption cannot bypass a moderation decision.

**Why this priority**: Admission policy from SPEC 001 is only safe when lifecycle decisions remain authoritative during reconnect.

**Independent Test**: Lock a room, kick a reconnecting participant, miss an event, and verify the next authoritative snapshot restores the correct state.

**Acceptance Scenarios**:

1. **Given** a room is locked, **when** a new participant attempts to join, **then** the participant is denied according to SPEC 001 while existing participants remain connected.
2. **Given** Minh is reconnecting while Linh kicks Minh, **when** the kick becomes authoritative, **then** the older reconnect cannot restore Minh.
3. **Given** a client misses a host or moderation event, **when** it resynchronizes, **then** the fresh snapshot identifies the current host and participant state without requiring event replay.
4. **Given** a participant is sharing media when removed, **when** moderation completes, **then** application membership and LiveKit participation are cleaned up without making LiveKit authoritative.

### User Story 4 - Lightweight Host Controls (Priority: P2)

As a host, I want lightweight participant controls that work on desktop and mobile without turning the room into an enterprise moderation dashboard.

**Why this priority**: Moderation must be discoverable while preserving the Stage-first social experience.

**Independent Test**: Use keyboard, touch, and screen-reader navigation to open the participant menu and complete a confirmed moderation action.

**Acceptance Scenarios**:

1. **Given** the current host opens a participant menu, **when** valid actions are available, **then** only meaningful authorized actions are shown.
2. **Given** a guest or non-host opens the same room, **when** they inspect participant controls, **then** host-only actions are absent and direct attempts remain denied server-side.
3. **Given** a destructive action is selected, **when** confirmation is required, **then** its label is clear and focus remains accessible on desktop, tablet, and mobile.

## Edge Cases

- Host has multiple tabs and one stale tab closes while another remains active.
- A stale close arrives after a newer connection is authoritative.
- Host transfer races with disconnect, failover, kick, lock, or another transfer.
- Target leaves, reconnects, or changes session generation during moderation.
- Only guests remain, no participants remain, or the owner is offline.
- Redis, PostgreSQL, LiveKit, or the target socket fails during an action.
- A temporary guest ban cannot guarantee identity beyond the existing guest/session model; no invasive fingerprinting is introduced.
- Duplicate moderation commands must converge without duplicate events or cleanup.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST distinguish durable room ownership from current realtime host authority.
- **FR-002**: The system MUST authorize every host-only action server-side using the existing centralized permission boundary.
- **FR-003**: The system MUST support explicit host transfer to an eligible connected participant and immediately revoke the old host's host-only authority.
- **FR-004**: The system MUST preserve the existing reconnect grace period and MUST NOT fail over a host solely because of a temporary disconnect.
- **FR-005**: After genuine host departure or grace expiry, the system MUST select at most one deterministic eligible successor and all backend instances MUST converge on it.
- **FR-006**: A returning former host MUST rejoin as a normal participant after authoritative failover unless an explicit supported transfer occurs.
- **FR-007**: The system MUST preserve kick semantics as a room-scoped moderation decision distinct from a normal participant leave.
- **FR-008**: A kicked participant's stale connection, reconnect, or cleanup callback MUST NOT restore membership or presence.
- **FR-009**: The system MUST reject self-kick, non-host moderation, invalid targets, stale targets, and duplicate destructive actions safely.
- **FR-010**: If temporary bans are supported, they MUST be room-scoped, time-limited, cross-instance consistent, and honest about anonymous guest identity limitations.
- **FR-011**: Locking MUST reuse SPEC 001 admission semantics: existing participants remain connected and new admission is blocked without removing everyone.
- **FR-012**: Moderation and host changes affecting canonical room state MUST be represented in authoritative snapshots and compatible domain events.
- **FR-013**: Cross-instance moderation MUST not depend on participants sharing one Go process or on Redis delivery order alone.
- **FR-014**: LiveKit cleanup MUST follow an authoritative application moderation decision; LiveKit MUST NOT become the moderation source of truth.
- **FR-015**: Failure of secondary cleanup MUST not undo a successful authoritative moderation decision, and success MUST not be reported before the authoritative decision succeeds.
- **FR-016**: Host controls MUST support keyboard, screen readers, touch, focus management, and responsive layouts without obstructing the Stage-first experience.
- **FR-017**: The system MUST preserve existing room access, reconnect, chat, presence, media, queue, and multi-instance behavior outside this feature.
- **FR-018**: Logs and metrics MUST omit passwords, tokens, secrets, and unnecessary high-cardinality participant data while exposing critical lifecycle outcomes.

### Key Entities

- **Durable Room Owner**: The persistent identity that owns the room and its durable settings.
- **Current Host**: The authoritative realtime participant permitted to perform host-only actions during an active session.
- **Participant Session**: A room-scoped identity and connection generation used to distinguish current presence from stale sockets.
- **Moderation Decision**: A server-authorized kick, temporary ban, lock, unlock, or host transfer with an authoritative outcome.
- **Temporary Room Ban**: A limited room-scoped restriction whose strength depends on the identity/session available for the target.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In 100% of tested host-transfer and failover scenarios, all connected clients and backend instances converge on one current host.
- **SC-002**: In 100% of kick/reconnect race tests, a kicked participant is not restored by stale reconnect or disconnect cleanup.
- **SC-003**: In 100% of authorization tests, non-host direct moderation attempts are rejected without changing room state.
- **SC-004**: A host can complete a valid participant removal from desktop and mobile controls without exposing raw transport or infrastructure errors.
- **SC-005**: Existing reconnect, room access, chat, presence, media, queue, and multi-instance regression suites remain passing after the feature.
- **SC-006**: No moderation path logs passwords, JWTs, guest secrets, LiveKit secrets, or Redis credentials.

## Assumptions

- SPEC 001 room access and lock semantics remain the admission source of truth.
- Existing Go room authority, snapshot recovery, Redis coordination, LiveKit integration, and kick behavior are extended rather than replaced.
- Current product identity semantics determine whether guests may become host; this specification requires the rule to be explicit during planning and implementation.
- Temporary anonymous guest bans are limited by the existing guest identity/session model and do not use invasive fingerprinting.
- No organization roles, global bans, reporting system, automated moderation, or enterprise dashboard is included.

## Existing Behavior to Preserve

- Existing host kick behavior, reconnect grace, participant lifecycle, room lock, snapshot recovery, typed realtime protocol, bounded broadcasts, and LiveKit media separation.
- Existing durable ownership and SPEC 001 password/access behavior.
- Existing lightweight participant menu and Stage-first visual hierarchy where they already satisfy these requirements.

## Out of Scope

- Enterprise RBAC, organizations, workspaces, moderator dashboards, permanent platform-wide bans, reports, appeals, automated or AI moderation, invasive guest fingerprinting, media effects, queue redesign, and unrelated authentication or database rewrites.
