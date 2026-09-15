# Feature Specification: Persistent Rooms & Room Access

**Feature Branch**: `001-persistent-rooms-room-access`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: Create the first MVP3 feature specification for persistent rooms and room access in the existing Loft application.

## User Scenarios & Testing

### User Story 1 - Create and Revisit a Persistent Room (Priority: P1)

As an authenticated Loft user, I want to create a named room that remains available after
everyone leaves so that my friends and I can return to the same shared space later.

**Why this priority**: Persistent ownership is the core MVP3 value and changes Loft from a
session-oriented room into a reusable social space.

**Independent Test**: An authenticated user creates a named room, leaves it with all participants,
reopens Loft later, finds the room in their rooms list, and enters it again.

**Acceptance Scenarios**:

1. **Given** Linh is authenticated, **when** Linh creates "Late Night Coding", **then** the room
   has a stable public identifier, a reusable invite path, and Linh is recognized as its owner.
2. **Given** all participants have left, **when** Linh later opens Loft, **then** the room still
   exists and can be entered without being recreated.
3. **Given** Linh closes a browser tab, **when** the tab closes, **then** the room is not deleted.

### User Story 2 - Join Without an Account (Priority: P1)

As a guest, I want to join an allowed room from an invite or public room identifier without
creating an account so that joining remains lightweight.

**Why this priority**: Guest-first joining is an existing Loft product promise and must survive the
MVP3 persistence upgrade.

**Independent Test**: A logged-out user opens a valid invite, supplies a display name when needed,
and joins a public room without completing authentication.

**Acceptance Scenarios**:

1. **Given** Minh is logged out and has a valid invite, **when** Minh opens it, **then** Loft offers
   a guest join path without requiring Google authentication.
2. **Given** a public room is available, **when** Minh enters its public identifier, **then** the
   same join rules apply as for the invite path.
3. **Given** room access requires a display name, **when** Minh submits a valid name, **then** Minh
   proceeds without creating a Loft account.

### User Story 3 - Protect a Room with a Password (Priority: P1)

As an owner, I want optional password protection so that I can share a room link while limiting
entry to people who know the password.

**Why this priority**: Persistent reusable links increase the importance of preventing unintended
entry and password bypass.

**Independent Test**: The owner enables password protection; a guest is denied with a wrong or
missing password, then joins with the correct password.

**Acceptance Scenarios**:

1. **Given** Linh enables password protection, **when** Minh opens the invite, **then** Loft asks
   for the password before admission.
2. **Given** Minh submits an incorrect password, **when** Loft verifies it, **then** access is
   denied with friendly corrective feedback and no secret is revealed.
3. **Given** Minh submits the correct password, **when** the room is still available, **then** Minh
   can continue the normal join flow.
4. **Given** Minh has not passed password verification, **when** Minh tries another protected-room
   entry path, **then** the room remains inaccessible.

### User Story 4 - Manage Access and Lock State (Priority: P1)

As the room owner, I want to change room name, password behavior, and lock state while preserving
the current session so that I can manage a reusable room without disrupting friends already inside.

**Why this priority**: Owners need practical control over who may enter, while existing MVP2 room
participants must not be unexpectedly removed.

**Independent Test**: An owner changes access settings, locks and unlocks the room, and verifies
existing and new participants observe the correct behavior.

**Acceptance Scenarios**:

1. **Given** participants are connected, **when** Linh changes the room password, **then** existing
   participants remain connected and future admission follows the new policy.
2. **Given** the room is active, **when** Linh locks it, **then** existing participants continue
   hanging out and a new joiner sees "This room is locked right now."
3. **Given** the room is locked, **when** Linh unlocks it, **then** new admission resumes according
   to the current password and room-access rules.
4. **Given** a non-owner attempts to change persistent access settings, **when** the request is
   evaluated, **then** the change is denied and the current settings remain unchanged.

### User Story 5 - Return Through Lightweight Room Lists (Priority: P2)

As an authenticated user, I want a lightweight list of rooms I own so that I can rejoin or open
room settings without turning the Lobby into an enterprise dashboard.

**Why this priority**: Discoverability makes persistence useful while remaining subordinate to the
stage-first Loft experience.

**Independent Test**: An owner opens the Lobby, identifies an owned room, enters it, and opens its
settings.

**Acceptance Scenarios**:

1. **Given** Linh owns two persistent rooms, **when** Linh opens the Lobby, **then** both rooms are
   identifiable and offer a clear rejoin action.
2. **Given** Linh selects an owned room's settings, **when** the settings are opened, **then** only
   the in-scope name, access, password, and lifecycle controls are presented.
3. **Given** an anonymous guest has visited a room, **when** the guest returns later, **then** Loft
   does not require server-side identity persistence solely to show recent rooms.

### User Story 6 - Leave, Archive, or Delete Deliberately (Priority: P2)

As an owner, I want an explicit lifecycle action for a persistent room so that leaving a session is
never confused with removing the room.

**Why this priority**: Persistence requires a safe, understandable distinction between presence and
the durable room lifecycle.

**Independent Test**: The owner leaves without deleting, then explicitly archives or deletes the
room and verifies future entry behavior.

**Acceptance Scenarios**:

1. **Given** Linh is inside a persistent room, **when** Linh leaves, **then** the room remains
   available and only Linh's realtime presence ends.
2. **Given** Linh explicitly chooses the supported removal action, **when** Linh confirms it, **then**
   the room becomes unavailable according to the defined lifecycle and is not silently recreated by
   a later invite attempt.
3. **Given** the removal action is destructive, **when** the confirmation is dismissed, **then** the
   room and its access policy remain unchanged.

### User Story 7 - Recover Safely Across Disconnects and Instances (Priority: P2)

As a participant, I want reconnect and access decisions to remain correct after network loss,
policy changes, or a request handled by another backend instance.

**Why this priority**: Persistence must not weaken existing snapshot recovery, security, or
multi-instance consistency.

**Independent Test**: Admit a guest, interrupt the network, change room access through another
instance, and verify reconnect behavior under both still-valid and invalid authorization.

**Acceptance Scenarios**:

1. **Given** Minh was legitimately admitted, **when** Minh briefly loses network and reconnects
   within the existing recovery rules, **then** Loft restores the session using current authoritative
   room state.
2. **Given** access becomes invalid while Minh is disconnected, **when** Minh reconnects, **then**
   security takes precedence and Loft denies or limits re-entry with a user-safe explanation.
3. **Given** Linh changes access through one backend instance, **when** Minh joins through another,
   **then** Minh observes the current authoritative lock and password policy.
4. **Given** a room is deleted or archived while Minh is joining, **when** admission completes,
   **then** Loft denies entry and does not recreate the old room.

### Edge Cases

- A legacy room created before this feature remains accessible under a defined backward-compatible
  default and is not corrupted by the upgrade.
- An invite, public identifier, or authorization attempt references a room that does not exist or is
  unavailable; the user sees a calm, non-technical message.
- A password is missing, wrong, expired, or submitted repeatedly; the user receives actionable
  feedback without learning whether a secret or internal identifier is valid.
- Repeated failed password attempts trigger bounded temporary protection, then recover after cooldown
  without permanently excluding legitimate users.
- Redis is temporarily unavailable; room access fails safely or uses the existing bounded fallback,
  while durable room data is not lost and internal infrastructure details stay out of UI copy.
- PostgreSQL is temporarily unavailable during a durable access change; the change is not reported as
  successful unless it is authoritative.
- A room password changes while participants are connected; existing sessions are not unexpectedly
  kicked, but future admission and reauthorization use the new policy.
- The owner leaves, reloads, or opens another tab; participant presence must not be converted into
  room deletion or duplicate durable ownership.
- Desktop, tablet, and mobile layouts preserve focus, readable errors, and stable dialog dimensions.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST allow an authenticated user to create a named persistent room.
- **FR-002**: The system MUST retain a persistent room after all realtime participants leave.
- **FR-003**: The system MUST distinguish durable room ownership from current realtime presence and
  current realtime host authority.
- **FR-004**: The system MUST preserve guest joining for allowed rooms without requiring account
  creation or authentication.
- **FR-005**: The system MUST support a reusable public room identifier and invite path without
  exposing an internal database identifier unnecessarily.
- **FR-006**: Invite URLs MUST NOT contain a room password, password hash, authorization token, or
  equivalent secret material.
- **FR-007**: The system MUST support public rooms and optional password-protected rooms as distinct
  concepts; password protection MUST NOT imply authenticated-only access.
- **FR-008**: The system MUST deny protected-room admission until the guest supplies a valid password
  through the normal join flow.
- **FR-009**: The system MUST ensure every protected-room entry path applies the same password policy;
  an alternate path MUST NOT bypass verification.
- **FR-010**: The system MUST prevent plaintext room passwords and password hashes from appearing in
  logs, metrics, user-visible errors, invite URLs, or client-authoritative state.
- **FR-011**: The system MUST rate-limit repeated failed password attempts with bounded attempts, a
  temporary cooldown, distributed correctness across backend instances, and recovery after cooldown.
- **FR-012**: Rate-limit responses MUST be calm and user-oriented and MUST NOT reveal internal
  coordination or keying details.
- **FR-013**: The authorized owner MUST be able to change the room name, password behavior, password,
  and in-scope lock state without unrelated advanced room settings.
- **FR-014**: The system MUST reject persistent room setting changes from unauthorized users.
- **FR-015**: Locking MUST block new admission while allowing already connected participants to remain
  connected; unlocking MUST restore admission under the current access policy.
- **FR-016**: The system MUST provide authenticated owners a lightweight way to identify, rejoin, and
  manage rooms they own without redesigning the Lobby as an enterprise dashboard.
- **FR-017**: Recent-room history MAY be exposed only when it uses existing meaningful data or safe
  browser-local behavior; anonymous server-side identity MUST NOT be introduced solely for it.
- **FR-018**: The system MUST distinguish leaving a room from archiving or deleting it, and accidental
  tab closure or disconnect MUST never delete a room.
- **FR-019**: Permanent deletion, if supported by the existing product model, MUST require explicit
  confirmation; otherwise the feature MUST use the existing compatible archive/removal lifecycle.
- **FR-020**: Deleted or archived rooms MUST not be silently recreated by a later invite or join
  attempt.
- **FR-021**: Presence MUST remain realtime and ephemeral; an empty participant list MUST NOT imply
  that the persistent room was removed, and durable membership MUST NOT imply current presence.
- **FR-022**: Reconnect and resynchronization MUST preserve existing snapshot-based recovery semantics
  and MUST re-evaluate access using current authoritative policy.
- **FR-023**: Access decisions MUST remain consistent regardless of which backend instance receives a
  request; correctness MUST NOT depend on sticky sessions unless already required by the product.
- **FR-024**: The system MUST define safe user-visible outcomes for not found, unavailable, locked,
  wrong password, rate-limited, expired authorization, concurrent policy change, database failure,
  coordination failure, reconnect denial, and media-token denial.
- **FR-025**: Access flows MUST use plain product language and MUST NOT expose HTTP, database, Redis,
  LiveKit, or authorization jargon to users.
- **FR-026**: Access, password, and settings flows MUST support keyboard use, visible focus, clear
  labels, screen-reader-friendly errors, accessible dialogs, and non-color-only status communication.
- **FR-027**: The feature MUST work on desktop, tablet, and mobile, preserve Stage-first room layout,
  support light/dark/system themes, and avoid layout jumps from errors or dialogs.
- **FR-028**: Important access decisions MUST be observable without recording passwords, hashes, access
  tokens, infrastructure credentials, or high-cardinality sensitive identifiers.
- **FR-029**: Normal joining MUST remain lightweight and MUST not require unnecessary polling, repeated
  expensive verification after valid admission, or avoidable room-wide broadcasts.
- **FR-030**: Existing MVP1/MVP2 behavior MUST remain intact, including Lobby, room creation, guest
  and invite join, chat, presence, microphone, camera, screen share, media-token issuance, reconnect,
  kick, lock, multi-instance coordination, and synchronized playback.
- **FR-031**: Face filters, background effects, Room Atmosphere, reactions, Raise Hand, advanced
  profiles, YouTube or queue upgrades, adaptive video quality, PWA work, complete host failover,
  co-hosts, complex roles, social graph, and workspace permissions MUST remain out of scope.

### Key Entities

- **Persistent Room**: A reusable shared space with a stable public identifier, name, owner, access
  policy, lock state, lifecycle state, and timestamps; it exists independently of active participants.
- **Room Owner**: The authenticated user with durable authority over the room's in-scope settings and
  lifecycle.
- **Room Access Policy**: The user-facing rule describing whether anyone with the link may join or a
  password is required, independent from authenticated identity and temporary lock state.
- **Room Invite**: A reusable shareable entry path that identifies a room without containing secret
  authorization material.
- **Room Session**: A temporary authenticated or guest participation session whose presence and
  reconnect validity do not define durable room existence.
- **Recent Room Entry**: Optional local or authorized room-return information that helps a user find
  rooms they actually visited without creating anonymous server identity solely for history.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In acceptance testing, 100% of authenticated room creators can leave and later re-enter
  a room without recreating it.
- **SC-002**: At least 95% of invited logged-out guests can enter an allowed public room without
  account creation on their first valid attempt.
- **SC-003**: In protected-room testing, 100% of incorrect or missing password attempts are denied and
  100% of valid password attempts are admitted when the room is otherwise available.
- **SC-004**: In brute-force testing, 100% of configured repeated-failure cases trigger temporary
  protection, recover after cooldown, and produce no secret-bearing logs or responses.
- **SC-005**: In multi-instance acceptance testing, 100% of join attempts observe the latest committed
  lock and password policy regardless of the receiving backend instance.
- **SC-006**: In reconnect testing, 100% of sessions with still-valid authorization receive current
  room state, while sessions invalidated by an access change are not silently restored.
- **SC-007**: In lifecycle testing, 100% of participant departures leave the persistent room intact,
  and 100% of explicitly removed rooms reject later entry without silent recreation.
- **SC-008**: At least 95% of representative desktop, tablet, and mobile access-flow tests complete
  without keyboard traps, inaccessible errors, clipped dialogs, or layout shifts that block joining.
- **SC-009**: Existing MVP1/MVP2 regression coverage reports zero new failures for guest join, invite
  join, chat, presence, media controls, reconnect, lock/kick behavior, and synchronized playback.
- **SC-010**: A representative public-room join completes in under 30 seconds on a normal connection,
  excluding explicit user time spent entering a password or granting device permissions.
- **SC-011**: User testing shows that at least 90% of participants correctly distinguish leaving a
  room from deleting or archiving it when shown the lifecycle controls.

## Assumptions

- Existing authenticated room creation and guest-session rules remain the baseline and are extended,
  not replaced.
- Existing six-digit public room codes, legacy invite compatibility, room lock semantics, snapshot
  reconnect, and multi-instance coordination are preserved unless a verified gap requires a product
  correction.
- The owner is the authenticated creator for this specification; host transfer, co-hosts, and full
  failover ownership are deferred to a later specification.
- Password hashing, credential/session representation, distributed rate-limit keys, migration shape,
  and package boundaries are implementation decisions for `$speckit-plan`.
- The exact permanent-delete versus archive behavior follows the existing product model discovered
  during planning; this specification requires an explicit, confirmed lifecycle outcome before
  implementation.
- Recent Rooms is secondary and may be deferred if it adds disproportionate complexity without
  blocking persistent ownership and safe access.
- Full browser/device and multi-instance release verification requires the configured external auth,
  database, Redis, and media services.

## Out of Scope

This specification does not include face filters, MediaPipe or background effects, Room Atmosphere,
reactions, Raise Hand, an advanced profile system, YouTube or queue upgrades unrelated to persistence,
adaptive video quality, PWA work, complete host failover, co-hosts, complex role hierarchies, social
graphs, friends/followers, or workspace/team permissions.

## Product Decisions Requiring Confirmation

1. Confirm whether the supported persistent-room removal action is permanent deletion, archive, or an
   existing lifecycle already present in Loft. Planning can then define the exact data-retention and
   user-visible behavior.
2. Confirm whether Recent Rooms should be included in the MVP3 implementation or remain a secondary
   follow-up after the core persistent-room flow is complete.
