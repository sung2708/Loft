# Feature Specification: Room Atmosphere

**Feature Branch**: `005-room-atmosphere`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Create MVP3 / SPEC 005 — Room Atmosphere for the existing Mingly application."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Share a Room Atmosphere (Priority: P1)

As the current room host, I want to choose Minimal, Ambient, Focus, or Party so that everyone experiences the same intentional room feeling without changing how they communicate.

**Why this priority**: A shared, host-controlled atmosphere is the core value of the feature and turns the room into a recognizable place rather than a generic call surface.

**Independent Test**: Connect a host and participant, change among all four modes, and verify both converge while voice, camera, screen sharing, chat, reactions, and shared media retain their prior state.

**Acceptance Scenarios**:

1. **Given** a newly created room, **When** it first opens, **Then** it has the deterministic Ambient atmosphere and the participant's personal color mode remains unchanged.
2. **Given** two participants in a room, **When** the host selects Minimal, Ambient, Focus, or Party, **Then** both participants receive the same semantic atmosphere and the Stage adopts the corresponding presentation.
3. **Given** a guest or non-host member, **When** they attempt to change the atmosphere, **Then** the change is rejected and their view returns to authoritative room state.
4. **Given** a host transfer, **When** the former host attempts a change and the new host makes one, **Then** only the new host's authorized mutation can become authoritative.

---

### User Story 2 - Keep Personal Theme Independent (Priority: P1)

As a participant, I want my light, dark, or system appearance preference to remain mine while the room shares an atmosphere so that joining a styled room never overwrites my application preference.

**Why this priority**: Confusing room personality with application color mode would regress an established accessibility and preference contract.

**Independent Test**: Join one Ambient room with two participants using different application color modes, change both the room atmosphere and an operating-system color mode, and verify each setting changes only its own visual layer.

**Acceptance Scenarios**:

1. **Given** Linh uses Light and Minh uses Dark, **When** both join an Ambient room, **Then** both perceive Ambient while retaining their respective color modes.
2. **Given** Linh uses System, **When** the operating system changes from Light to Dark, **Then** Mingly follows the system while the semantic room atmosphere remains unchanged.
3. **Given** Party is selected, **When** any participant leaves and opens another Mingly surface, **Then** Party has not replaced that participant's personal appearance preference.

---

### User Story 3 - Give the Room a Restrained Accent (Priority: P2)

As the current host, I want to select from a small set of safe room accents so that a persistent room has visual personality without weakening product identity or semantic controls.

**Why this priority**: Accent adds durable personality after the foundational shared modes work, while keeping Mingly's interaction language stable.

**Independent Test**: Select each supported accent and verify all participants converge, decorative room surfaces change, and danger, success, focus, and destructive controls retain their established meanings and contrast.

**Acceptance Scenarios**:

1. **Given** a supported accent, **When** the host selects it, **Then** the room's decorative presentation updates for all participants.
2. **Given** any room accent, **When** an error, success, focus, or destructive action appears, **Then** its semantic meaning remains visually unambiguous.
3. **Given** an arbitrary accent value, URL, or style payload, **When** it is submitted, **Then** it cannot become room state or executable presentation.

---

### User Story 4 - Restore Atmosphere Reliably (Priority: P2)

As a participant joining late or reconnecting, I want to receive the room's current appearance immediately so that my view does not remain stale or depend on missed events.

**Why this priority**: Shared atmosphere is credible only when persistent rooms and distributed participants converge consistently.

**Independent Test**: Save an appearance, empty and reopen the room, join late, reconnect after a change, and connect participants through separate application instances; every path must resolve to the same current state.

**Acceptance Scenarios**:

1. **Given** a persistent room saved as Ambient with an approved accent, **When** everyone leaves and later rejoins, **Then** that appearance is restored.
2. **Given** a participant disconnects while the host changes Ambient to Focus, **When** the participant reconnects, **Then** the fresh room state shows Focus without replaying every missed visual change.
3. **Given** a late joiner, **When** room bootstrap completes, **Then** the joiner receives the current appearance and does not remain on a random or stale default.
4. **Given** participants connected through different application instances, **When** the host changes appearance, **Then** all participants converge and a coordination outage cannot replace durable room truth.
5. **Given** concurrent stale mutations, **When** they are evaluated, **Then** existing authority and version rules determine one result and clients reconcile to it.

---

### User Story 5 - Adapt Safely to Shared Media (Priority: P3)

As a participant, I want an enabled Ambient or Party room to draw a subtle treatment from supported shared YouTube media so that the Stage feels connected to what we are watching without changing playback.

**Why this priority**: Media awareness adds delight but is optional and must remain subordinate to communication reliability and provider constraints.

**Independent Test**: Start, change, and end supported shared media; simulate unavailable artwork and analysis failure; verify treatment changes or falls back smoothly while playback and Stage identity stay mounted and functional.

**Acceptance Scenarios**:

1. **Given** adaptive background is enabled and supported shared YouTube media starts, **When** safe media information is available, **Then** a restrained media-derived Stage treatment may appear without proxying or restreaming media.
2. **Given** media information is unavailable, blocked, invalid, or cannot be analyzed, **When** playback continues, **Then** the normal room atmosphere and accent remain usable.
3. **Given** the queue advances from one video to another, **When** the derived treatment changes, **Then** Mingly-owned surfaces avoid abrupt full-screen flashes and the player and participant tracks are not remounted solely for the transition.
4. **Given** shared media ends, **When** there is no active media, **Then** stale media-derived treatment clears and the room returns to its normal appearance.

---

### User Story 6 - Preserve Stage Clarity and Device Capacity (Priority: P3)

As a participant, I want atmosphere to enhance empty space around shared activity while yielding to screen share, camera, controls, accessibility settings, and weak-device needs.

**Why this priority**: Atmosphere is decoration; it succeeds only when Mingly's Stage-first communication experience remains clearer and more reliable than the enhancement.

**Independent Test**: Exercise screen share, camera, camera-off, solo, drawers, reduced motion, mobile layouts, and constrained-device fallback in every atmosphere and verify essential content and controls remain readable and operable.

**Acceptance Scenarios**:

1. **Given** screen share begins in Party, **When** the Stage changes layout, **Then** the shared screen remains primary, its pixels remain untouched, atmosphere recedes, and the participant strip and Call Dock do not overlap.
2. **Given** a participant uses camera Blur and Glasses, **When** the room uses Ambient, **Then** participant effects remain local to that camera while atmosphere remains a room-level surrounding presentation.
3. **Given** a voice-only or solo camera-off room, **When** atmosphere fills surrounding space, **Then** avatars retain sensible sizing and active-speaker and identity cues remain readable.
4. **Given** Chat, People, or Queue is open, **When** adaptive atmosphere is active, **Then** drawer content remains predictable and message ownership alignment does not change.
5. **Given** reduced motion is enabled, **When** Party is active or media changes, **Then** Party remains recognizable without unnecessary continuous or large decorative motion.
6. **Given** a weak device cannot sustain an enhancement comfortably, **When** degradation occurs, **Then** decoration simplifies before voice, camera, screen sharing, shared media, or core controls degrade.

### Edge Cases

- A room created before SPEC 005 has no stored appearance values; it loads with a safe deterministic fallback and remains editable without destructive migration.
- Stored or incoming atmosphere, accent, or adaptive values are missing, malformed, unsupported, or from a newer client; unsupported data cannot become arbitrary styling and falls back safely.
- An authorized request races with host transfer, lock/settings changes, reconnect, or another appearance mutation; existing authority and version semantics select the result.
- A participant receives a cross-instance update before or after a room snapshot; stale state must not overwrite newer authoritative state.
- Media artwork is unavailable, cross-origin restricted, too large, corrupt, slow, or changes rapidly as a queue advances; playback remains unaffected and analysis is bounded per meaningful media change.
- Screen share starts or stops during an atmosphere transition; shared pixels, Stage identity, participant tracks, and Call Dock placement remain stable.
- Application color mode changes while an atmosphere transition is in progress; both semantic layers remain independently correct.
- Contrast becomes unsafe against a derived color; controlled mapping or the normal room accent is used instead of arbitrary foreground color.
- Reduced-motion preference changes during a session; non-essential motion stops or resumes without changing room state.
- An enhancement subsystem fails or is unavailable; the room continues with a safe static presentation and no communication feature is interrupted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST represent Room Atmosphere as explicit shared room state with exactly four supported semantic modes: Minimal, Ambient, Focus, and Party.
- **FR-002**: Minimal MUST provide the most restrained, low-distraction presentation; Ambient MUST provide a subtle warm and spatial presentation; Focus MUST visually prioritize primary shared content; Party MUST provide a more expressive but non-flashing social presentation.
- **FR-003**: Atmosphere MUST affect presentation only and MUST NOT mute, hide, stop, start, disconnect, authorize, or otherwise change communication or shared-media semantics.
- **FR-004**: A room's application-defined appearance MUST include a controlled room accent and an on/off adaptive-media-background preference in addition to its atmosphere.
- **FR-005**: Newly created rooms MUST default deterministically to Ambient. Rooms missing SPEC 005 values MUST load with a safe deterministic fallback equivalent to Ambient and the standard Mingly accent.
- **FR-006**: Only the current host, or an already existing explicitly authorized role, MUST be permitted to mutate shared room appearance through the established permission model.
- **FR-007**: Unauthorized, stale, malformed, and conflicting mutations MUST leave authoritative room appearance unchanged and clients MUST reconcile to the authoritative result.
- **FR-008**: Shared room appearance MUST be durable for persistent rooms and survive an empty room, process restart, and later reuse.
- **FR-009**: Durable room appearance MUST have one durable source of truth; transient coordination and participant presentation state MUST NOT become competing durable authorities.
- **FR-010**: Appearance changes MUST propagate as small semantic state to connected participants, including participants connected through different application instances.
- **FR-011**: The current appearance MUST be included in normal authoritative room bootstrap and snapshot recovery so late joiners and reconnecting participants converge without event replay.
- **FR-012**: Appearance mutations MUST follow existing room authority and conflict/version rules, including during concurrent mutation and host transfer.
- **FR-013**: The room appearance control MUST be available through the established room-settings experience without creating a second settings or permission system.
- **FR-014**: Personal Light, Dark, and System color modes MUST remain independent participant preferences and MUST NOT be read from, overwritten by, or persisted as room atmosphere.
- **FR-015**: Existing personal theme bootstrap, hydration behavior, and persisted preference keys MUST remain backward compatible.
- **FR-016**: Room accents MUST come from a small application-defined allowlist; arbitrary colors, CSS, gradients, URLs, markup, scripts, shaders, or theme documents MUST be rejected or normalized safely.
- **FR-017**: Room accent MUST primarily affect atmospheric and decorative surfaces; product interaction identity and semantic danger, success, focus, destructive, and accessibility states MUST remain stable and distinguishable.
- **FR-018**: When adaptive media background is enabled, Mingly MAY derive a restrained treatment only from safely available information associated with media already shared in the room.
- **FR-019**: Adaptive treatment MUST NOT download, proxy, re-encode, restream, or inspect provider video frames on Mingly servers and MUST NOT transmit media frames or artwork blobs through the application realtime channel or coordination layer.
- **FR-020**: Adaptive derivation MUST occur at most once per meaningful media/artwork change, use bounded work, and fall back to normal room appearance when information, permission, decoding, contrast, or analysis is unsuitable.
- **FR-021**: Adaptive treatment failure MUST NOT interrupt or alter shared media playback, media volume, media authority, queue behavior, synchronization, or provider-player behavior.
- **FR-022**: A media change or appearance change MUST NOT remount the shared player, participant tracks, or Stage solely to animate atmosphere; Mingly-owned surfaces MUST avoid abrupt flashes and dangerous luminance changes.
- **FR-023**: When no shared media is active, stale media-derived treatment MUST clear and the configured atmosphere/accent MUST become the deterministic fallback.
- **FR-024**: Screen share MUST remain the primary Stage content, its pixels MUST remain unmodified, and atmosphere MUST become visually secondary without overlapping participant or control regions.
- **FR-025**: Atmosphere MUST NOT tint or process participant media tracks and MUST remain separate from SPEC 004 camera effects and processing state.
- **FR-026**: Camera, camera-off, voice-only, solo, and multi-participant layouts MUST preserve existing participant sizing, identity, mute, sharing, and active-speaker cues.
- **FR-027**: Chat, People, and Queue surfaces MUST remain readable and predictable; atmosphere MUST NOT change message ownership semantics or aggressively derive drawer colors from media.
- **FR-028**: SPEC 003 reaction events and authority MUST remain unchanged; atmosphere MAY vary only their local presentation intensity without adding atmosphere-specific protocol events.
- **FR-029**: Atmosphere selection MUST be silent and independent of existing sound-effect preferences; no ambient audio, background loop, or automatic volume change may be introduced.
- **FR-030**: All supported atmospheres MUST maintain readable text, icons, controls, participant labels, focus indicators, active-speaker indicators, and system messages under both light and dark presentation.
- **FR-031**: Reduced-motion users MUST receive the same semantic atmosphere with continuous and large decorative movement removed or minimized.
- **FR-032**: Party and media transitions MUST NOT use strobing, rapid full-screen flashing, or high-frequency luminance changes.
- **FR-033**: At widths equivalent to 1440, 1280, 1024, 768, 430, and 375 pixels, atmosphere MUST preserve Stage priority, safe areas, participant strip visibility, control operability, and freedom from horizontal or Call Dock overlap.
- **FR-034**: The presentation MUST support a safe static fallback and MUST reduce decorative motion, blur, adaptive treatment, and compositing cost before reducing voice, camera, screen-share, shared-media, or core-UI quality.
- **FR-035**: Atmosphere MUST NOT infer mood from faces, emotion, voice, microphone content, or chat sentiment and MUST NOT persist or log private media content.
- **FR-036**: Failure of appearance rendering, adaptive derivation, propagation, or invalid stored state MUST be isolated from voice, camera, screen share, chat, presence, reconnect, and shared media.
- **FR-037**: Operational diagnostics SHOULD distinguish successful mutations, permission rejection, invalid values, conflicts, propagation delay, adaptive fallback, and derivation failure without high-volume visual telemetry or private content.
- **FR-038**: All MVP1/MVP2 and SPEC 001–004 behavior listed in Backward Compatibility MUST remain functionally unchanged except for intentional room-presentation additions.

### Key Entities

- **Room Appearance**: The current durable, shared presentation configuration for one room: semantic atmosphere, controlled accent, adaptive-media-background preference, and the version needed to order authoritative changes.
- **Atmosphere Mode**: One application-defined semantic choice—Minimal, Ambient, Focus, or Party—that describes room presentation without carrying arbitrary styling instructions.
- **Room Accent**: One approved decorative color identity for a room; separate from the Mingly product accent and semantic status colors.
- **Adaptive Media Treatment**: Optional, disposable presentation derived from safely available current shared-media context. It is not durable media, room authority, or provider content.
- **Application Color Mode**: A participant-owned Light, Dark, or System preference that remains independent from Room Appearance.

## Backward Compatibility

- Preserve guest-first joining, authentication, persistent rooms, room access/password/lock, owner semantics, host lifecycle, kick/ban, reactions, presence, Raise Hand, reconnect/resync, voice, camera, screen sharing, chat, YouTube synchronization, queue behavior, multi-instance coordination, Stage layouts, personal light/dark/system preferences, responsive behavior, and SPEC 004 effects.
- Existing rooms with no appearance data MUST continue loading and receive a safe default without rewriting historical migrations or requiring destructive data repair.
- Existing technical and persisted identifiers remain unchanged unless a separately justified backward-compatible migration is planned.

## Out of Scope

- Arbitrary user CSS, JavaScript, gradients, shaders, theme documents, or uploaded executable presentation.
- Theme marketplaces, paid or downloadable themes, NFT themes, profiles/preferences redesign, or full PWA work.
- 3D rooms, metaverse/avatar worlds, game mechanics, weather simulation, or ambient background audio.
- AI emotion, face, voice, microphone, or chat-sentiment mood detection.
- Automatic music selection or changes to YouTube volume/playback semantics.
- Server-side YouTube frame extraction, media proxying, downloading, re-encoding, or restreaming.
- Modification of screen-share pixels or participant camera effects.
- Exact palette, storage schema, transport event names, coordination channel names, client state shape, extraction technique, animation primitives, or styling implementation; these belong to planning.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tests covering all four atmosphere modes, connected participants receive one authoritative semantic atmosphere while all communication and media states remain unchanged.
- **SC-002**: In 100% of Light, Dark, and System combinations tested with every atmosphere, changing room atmosphere never changes a participant's personal color-mode preference, and changing color mode never changes room atmosphere.
- **SC-003**: New rooms and 100% of legacy rooms without appearance data load successfully with a deterministic safe appearance.
- **SC-004**: In late-join, reconnect, empty-room reuse, host-transfer, concurrent-mutation, and multi-instance scenarios, all participants converge to the current authoritative room appearance with no permanent divergence.
- **SC-005**: In 100% of unauthorized and invalid-value tests, shared appearance remains unchanged and no arbitrary style, URL, markup, or executable content reaches presentation.
- **SC-006**: In 100% of adaptive-media failure tests, shared playback continues and the Stage returns to the configured atmosphere/accent without stale media treatment.
- **SC-007**: Across widths equivalent to 1440, 1280, 1024, 768, 430, and 375 pixels, all essential Stage content and call controls remain operable with no horizontal overflow or Call Dock overlap introduced by atmosphere.
- **SC-008**: In every supported atmosphere, text, controls, participant labels, focus cues, and status semantics satisfy the project's existing accessibility contrast checks in both light and dark presentation.
- **SC-009**: With reduced motion enabled, 100% of functional appearance changes remain understandable without continuous decorative animation, strobe, or rapid full-screen flashing.
- **SC-010**: Under constrained-device and appearance-subsystem failure tests, voice, camera, screen share, shared media, chat, presence, and reconnect remain usable while decoration degrades to a safe static fallback.
- **SC-011**: Starting, changing, or ending adaptive shared media causes zero player, Stage, or participant-track remounts attributable solely to atmosphere transitions.
- **SC-012**: In usability verification, at least 90% of participants can distinguish Minimal, Ambient, Focus, and Party and identify the current host-controlled room feeling without mistaking it for their personal application color mode.

## Assumptions

- Ambient is the default for newly created rooms; legacy rooms with missing data resolve to Ambient plus the standard Mingly accent.
- The initial room-accent catalog is intentionally small and application-defined; exact names and palette values will be validated during planning.
- The current host is the default role allowed to change appearance; any broader authorization is used only if already supported by the existing centralized permission model.
- Adaptive media background is optional, off or safely degraded when provider/browser restrictions prevent trustworthy derivation, and never blocks the rest of SPEC 005.
- Room Appearance belongs with existing persistent room settings and authoritative snapshots rather than a parallel theme or preference system.
- Existing application theme persistence, Stage layouts, shared-media authority, reaction semantics, and participant camera-effects ownership remain dependencies to preserve.
