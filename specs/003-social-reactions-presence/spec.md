# Feature Specification: Social Reactions & Presence

**Feature Branch**: `[003-social-reactions-presence]`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "MVP3 / SPEC 003 — Social Reactions & Presence for the existing realtime Mingly application"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - React Without Interrupting (Priority: P1)

As a participant, I want to send a small supported reaction so that I can respond socially without interrupting conversation or creating permanent chat history.

**Why this priority**: Reactions deliver the central social value and an existing partial flow can be extended safely.

**Independent Test**: Put two participants in one room, send every supported reaction, and verify attribution, brief Stage feedback, stable layout, expiry, and absence from chat history.

**Acceptance Scenarios**:

1. **Given** Linh and Minh share a room, **when** Linh sends ❤️, **then** Minh sees brief feedback attributed to Linh, the Stage does not shift, and the reaction disappears without entering chat.
2. **Given** the reaction control is open, **when** choices are inspected, **then** only ❤️, 😂, 🔥, 👏, and 😭 appear and each has an accessible name.
3. **Given** Linh rapidly sends several 👏 reactions, **when** the burst is presented, **then** work and visible items remain bounded, feedback may be grouped, and call/media remain responsive.
4. **Given** a participant exceeds the effective allowance, **when** more reactions are submitted, **then** excess activity is limited without permanently penalizing ordinary use.
5. **Given** Linh and Minh use different service instances, **when** Linh sends 😂, **then** Minh receives behavior equivalent to a single-instance room.
6. **Given** a client submits an unsupported value or another participant's identity, **when** validated, **then** it is rejected and no arbitrary content or false attribution is broadcast.

---

### User Story 2 - Raise and Lower a Hand (Priority: P1)

As a participant, I want to raise or lower my hand so that I can signal for attention while the room stays casual.

**Why this priority**: Raise Hand is current participant state and must remain correct across reconnect, snapshots, races, and removal.

**Independent Test**: Raise a hand, reconnect within grace, lower it, then leave and verify one logical participant and no stale indicator.

**Acceptance Scenarios**:

1. **Given** Minh is admitted, **when** Minh raises a hand, **then** everyone sees a restrained indicator associated with Minh until lowered or cleared.
2. **Given** Minh's hand is raised, **when** Minh lowers it, **then** authoritative state changes and the indicator disappears everywhere.
3. **Given** Minh reconnects within valid recovery semantics, **when** a fresh room state arrives, **then** one logical participant remains and current hand state is restored.
4. **Given** a newer connection replaced an old one, **when** the old connection closes or sends stale state, **then** it cannot clear or restore newer state.
5. **Given** Minh truly leaves, is kicked, or is temporarily banned, **when** cleanup completes, **then** Raise Hand clears and no ghost indicator remains.
6. **Given** host authority changes, **when** transfer or failover completes, **then** hand state remains owned by its participant and SPEC 002 governance is unchanged.

---

### User Story 3 - Wave to the Room (Priority: P2)

As a participant, I want to wave to the current room so that I can greet people without creating a message or acknowledgement obligation.

**Why this priority**: Room-level Wave adds warmth without direct-notification complexity.

**Independent Test**: Wave in a multi-participant room and verify one attributed, ephemeral, rate-limited signal with no history.

**Acceptance Scenarios**:

1. **Given** Minh is admitted, **when** Minh waves, **then** the room receives friendly feedback equivalent to “Minh waves 👋”.
2. **Given** participants use different instances, **when** one waves, **then** all reachable room participants receive equivalent behavior.
3. **Given** repeated waves exceed reasonable use, **when** the allowance is exhausted, **then** excess waves are limited and the room remains responsive.
4. **Given** a Wave expires or its sender leaves, **when** the Stage updates, **then** no stale Wave remains.

---

### User Story 4 - Trustworthy Room Presence (Priority: P1)

As a participant, I want a brief network interruption distinguished from a true departure so the room avoids duplicate people and noisy join/leave feedback.

**Why this priority**: Social signals are trustworthy only when identity and lifecycle agree with existing reconnect and moderation behavior.

**Independent Test**: Join, disconnect briefly, reconnect, replace a stale connection, and leave across one and multiple instances while checking participant count and system feedback.

**Acceptance Scenarios**:

1. **Given** Minh briefly loses network, **when** reconnect succeeds within grace, **then** the same logical participant returns without duplicate presence or unnecessary left/joined feedback.
2. **Given** grace expires, **when** departure becomes authoritative, **then** one true leave transition occurs and transient participant state clears.
3. **Given** an old connection closes after a newer one is valid, **when** stale cleanup runs, **then** newer presence remains.
4. **Given** state changes were missed, **when** a fresh snapshot arrives, **then** current state is reconciled without replaying expired reactions or Waves.
5. **Given** speaking, mic, camera, or screen-share changes, **when** Stage presentation updates, **then** actual media state remains authoritative and no competing detector is introduced.

---

### User Story 5 - Calm Local Sound Feedback (Priority: P2)

As a participant, I want optional restrained sound feedback so the interface feels responsive without making the room noisy.

**Why this priority**: SFX adds warmth but must remain isolated from critical call and shared-media audio.

**Independent Test**: Exercise local controls, room transitions, settings, blocked playback, and missing assets while verifying call/media behavior is unchanged.

**Acceptance Scenarios**:

1. **Given** Linh toggles mute, **when** the action succeeds, **then** Linh may hear local confirmation and remote participants hear no UI mute sound.
2. **Given** Minh joins, **when** joining becomes authoritative, **then** existing participants may hear a preference-controlled join cue and Minh may hear room-entry feedback without a server sound command.
3. **Given** Sound Effects or Room Sounds is disabled, **when** an applicable event occurs, **then** that SFX category stops immediately while participant and shared-media audio remain unchanged.
4. **Given** reactions or chat arrive, **then** they remain silent by default.
5. **Given** browser playback is blocked or an asset fails, **then** failure is quiet and bounded and joining, chat, microphone, camera, screen sharing, and shared media continue.

---

### User Story 6 - Accessible Responsive Controls (Priority: P2)

As a participant on any supported device or accessibility setting, I want social controls and state to remain understandable and reachable without obscuring the Stage.

**Why this priority**: Social feedback must work with keyboard, assistive technology, reduced motion, screen sharing, and compact layouts.

**Independent Test**: Use keyboard and touch at 1440, 1280, 1024, 768, 430, and 375 widths, including screen sharing and reduced motion.

**Acceptance Scenarios**:

1. **Given** a keyboard user, **when** they use social controls, **then** labels, focus order, state, dismissal, and focus return are correct.
2. **Given** reduced motion, **when** reactions or Waves occur, **then** meaning remains while motion is removed or substantially simplified.
3. **Given** screen sharing at 375 pixels wide, **when** social feedback appears, **then** shared content stays primary and the participant strip, Call Dock, and chat remain usable.
4. **Given** animation is unavailable, **when** a hand is raised, **then** persistent semantic and visual state still communicates it.

### Edge Cases

- Delayed social events arriving after authoritative leave do not recreate presence.
- Duplicate events do not become history or extend lifetime without a newly accepted action.
- Slow consumers may lose expendable social events before authoritative participant state.
- Kick/ban racing with Raise Hand is won by SPEC 002 removal and clears social state.
- Distributed coordination failure degrades cross-instance social delivery without crashing rooms, calls, or causing retry storms.
- Empty room/unmount cleans timers, animation loops, audio, listeners, and subscriptions.
- Hidden tab, silence, mute, camera-off, or inactivity alone never marks a participant Away.
- Legacy reaction values no longer in the final set do not appear in new controls or enable arbitrary rendering.

## Requirements *(mandatory)*

### Existing Behavior Discovered and Preserved

- One typed room realtime flow already owns join/leave, snapshots, reconnect grace, same-tab replacement, stale-close protection, bounded delivery, cross-instance fanout, and distributed limits.
- Partial reactions already validate a fixed set, apply participant/room limits, broadcast ephemerally, aggregate visible groups, and expire. This is extended, not replaced.
- The existing set includes 👍 and 🎉 but omits 😭; SPEC 003 defines ❤️, 😂, 🔥, 👏, and 😭 as the complete product set.
- LiveKit already supplies actual speaking, microphone, camera, and screen-share state and remains authoritative.
- No integrated Wave, Raise Hand, automatic AFK, or application SFX manager was found. Unintegrated audio files are not a completed SFX system.
- SPEC 001 access and SPEC 002 host/moderation behavior remain authoritative.

### Source-of-Truth Boundaries

- Server room authority owns admitted participation, Reaction/Wave validation, and current Raise Hand state.
- Durable rooms, access, memberships, messages, and bans remain durable; reactions, Waves, and hands are not persisted by default.
- LiveKit owns tracks, speaking, microphone, camera, screen share, and media connectivity.
- Redis is ephemeral cross-instance coordination and effective shared rate limiting, never durable history.
- Frontend owns bounded presentation, animation, reduced-motion behavior, and local SFX policy, not identity or canonical room state.

### Product Decisions

- Wave is room-level; direct targeting is deferred.
- Automatic AFK is deferred because visibility, silence, mute, camera-off, and inactivity are unreliable.
- Raise Hand is self-controlled; host lowering and automatic tile reordering are deferred.
- Reactions and chat are silent by default.

### Functional Requirements

- **FR-001**: The system MUST extend existing participant, realtime, snapshot, and coordination paths and MUST NOT create duplicate presence, event, snapshot, client, store, or media authorities.
- **FR-002**: Admitted participants MUST be able to send exactly ❤️, 😂, 🔥, 👏, or 😭.
- **FR-003**: Identity MUST come from the authorized connection; unsupported values, arbitrary content, spoofing, and out-of-room targeting MUST be rejected.
- **FR-004**: Reactions and Waves MUST be attributed, ephemeral, non-durable, absent from chat, finite in lifetime, and bounded in visible count/work.
- **FR-005**: Participant and room-level limits MUST apply across instances; ordinary use MUST recover after a short allowance period.
- **FR-006**: Healthy multi-instance rooms MUST deliver accepted reactions, Waves, and hand changes equivalently to single-instance rooms.
- **FR-007**: Coordination failure MUST NOT crash rooms, block calls, create unbounded retries, or elevate social events above authoritative state.
- **FR-008**: Slow consumers MUST NOT block rooms or create unbounded memory/work; reactions and Waves MAY be coalesced or dropped first.
- **FR-009**: Participants MUST be able to send a room-level Wave with no acknowledgement or history.
- **FR-010**: Participants MUST control only their own Raise Hand state, validated against the current admitted connection.
- **FR-011**: Raise Hand MUST remain current participant state until self-lowered or cleared by true leave/removal.
- **FR-012**: Fresh snapshots MUST include current hands but MUST NOT replay expired reactions or Waves.
- **FR-013**: Reconnect within grace MUST restore one logical participant and current hand state without duplicate join/leave feedback.
- **FR-014**: Stale connections MUST NOT mutate newer presence or hand state.
- **FR-015**: Leave, grace expiry, kick, ban, and room emptying MUST clear retained social state and ghost indicators.
- **FR-016**: Join/leave feedback, if shown in chat, MUST be neutral system feedback and MUST avoid reconnect duplicates.
- **FR-017**: Speaking, mic, camera, screen share, and media connection MUST remain LiveKit-authoritative with no competing detector.
- **FR-018**: Existing adaptive Stage and screen-share priority MUST remain stable; social feedback MUST NOT shift layout, remount tracks, or obscure shared content, names, participant strip, controls, Call Dock, or chat.
- **FR-019**: Participant tiles MUST compose a restrained hand indicator with existing variants without badge overload or automatic reordering.
- **FR-020**: SPEC 003 MUST NOT infer AFK or expose cross-room status, last seen, fingerprinting, or detailed activity history.
- **FR-021**: Servers MUST emit domain facts only—never sound, animation, coordinate, asset URL, or audio-payload commands.
- **FR-022**: UI SFX, participant audio, and shared-media audio MUST remain independent.
- **FR-023**: Sound Effects and Room Sounds MUST be separate preferences with one SFX volume and immediate effect, without changing participant/shared-media volume.
- **FR-024**: Reactions and chat MUST be silent by default; remote mic/camera toggles MUST NOT produce UI sounds for others.
- **FR-025**: Eligible SFX MAY cover local media controls and meaningful room lifecycle events but MUST be short, warm, consistent, and restrained.
- **FR-026**: Autoplay restrictions and missing assets MUST fail quietly and MUST NOT block any room, communication, or media capability.
- **FR-027**: Controls MUST support keyboard/touch, labels, semantic state, predictable focus, and feedback beyond emoji/motion alone.
- **FR-028**: Reduced motion MUST simplify spatial effects while preserving attribution, expiry, and hand meaning.
- **FR-029**: Controls and feedback MUST work without horizontal page scrolling at 1440, 1280, 1024, 768, 430, and 375 widths and MUST NOT add a permanent toolbar.
- **FR-030**: All transient timers, animation frames, audio, listeners, subscriptions, and handlers MUST clean up on removal, leave, and unmount.
- **FR-031**: Observability MUST distinguish accepted, limited, dropped, stale, and propagation-failed actions without noisy per-emoji logs or secrets.
- **FR-032**: The feature MUST NOT add durable writes/background tasks per reaction, permanent history, unbounded queues, or polling.
- **FR-033**: Lobby, joining, guest access, SPEC 001 access, SPEC 002 governance, reconnect, chat, LiveKit media, playback, and queue behavior MUST remain compatible.

### Key Entities

- **Social Signal**: An attributed, room-scoped, validated Reaction or Wave with finite presentation lifetime and no durable history.
- **Reaction Kind**: One of ❤️, 😂, 🔥, 👏, and 😭.
- **Participant Social State**: Current Raise Hand state attached to one authoritative participant and reconciled through snapshots.
- **Presence Session**: Existing logical room participation plus current connection generation, distinguishing recovery from true departure.
- **SFX Preference**: Local Sound Effects, Room Sounds, and SFX volume, isolated from call/shared-media audio.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of five supported reactions are correctly attributed, visible to another participant, gone within 5 seconds, and absent from chat history.
- **SC-002**: During 100 reaction attempts in 10 seconds, visible groups stay at or below 6, controls remain operable, and call audio is uninterrupted.
- **SC-003**: In one- and two-instance tests, 100% of accepted test reactions, Waves, and hand changes reach connected participants while coordination is healthy.
- **SC-004**: In 100% of reconnect-within-grace tests, exactly one logical participant remains, hand state is recovered, and no false leave/join pair appears.
- **SC-005**: In 100% of stale-close, leave, kick, and ban race tests, newer presence survives and removed participants leave no hand state.
- **SC-006**: A 5-minute burst/slow-consumer test produces no room-wide blocking, unbounded growth, or call interruption.
- **SC-007**: During a coordination outage, same-instance room/call actions remain usable, no crash/retry storm occurs, and degradation is observable within 30 seconds.
- **SC-008**: At every required width, controls are reachable without horizontal scrolling and feedback overlaps none of shared content, participant strip, Call Dock, or chat.
- **SC-009**: Keyboard/screen-reader tests complete Reaction, Wave, Raise/Lower Hand with 100% named controls and state understandable without motion.
- **SC-010**: With reduced motion, meaning remains and nonessential spatial motion is removed or reduced to 160ms or less.
- **SC-011**: With SFX disabled or blocked, 100% of joining, chat, call, media-control, camera, microphone, screen-share, and shared-media flows still work.
- **SC-012**: Existing SPEC 001/002 and realtime/media regression suites show no feature-caused regressions.

## Assumptions

- Mingly is the current product identity; “Loft” in the input denotes the existing product under its former name.
- Authenticated users and admitted guests can react, Wave, and control their own hand using existing identity strength.
- Existing reconnect grace, single-session behavior, capacity, and moderation rules remain unchanged.
- Past reactions/Waves are best effort; current Raise Hand has stronger snapshot reconciliation requirements.
- Preference placement may be finalized by a later Profile/Preferences spec, but this spec defines required behavior.

## Dependencies

- Existing identity, admission, typed realtime flow, bounded fanout, snapshot, reconnect, stale-session protection, and distributed coordination.
- Existing LiveKit-authoritative media lifecycle and adaptive Stage.
- SPEC 001 access and SPEC 002 host/moderation decisions.
- Approved SFX assets before production sound behavior can be verified.

## Out of Scope

- Unlimited emoji, stickers, GIFs, gifts, coins, reaction history/analytics, avatars, or gamification.
- Direct Wave, acknowledgement, direct messaging, friends/followers, global status, last seen, or enterprise presence.
- Automatic AFK, invasive tracking, fingerprinting, host Lower Hand, meeting queues, or hand-based tile reordering.
- Reaction/chat audio, server sound commands, or WebSocket audio.
- Face effects, backgrounds, Room Atmosphere, YouTube/queue redesign, PWA, or AI analysis/moderation.

## Product Decisions Requiring Confirmation

No unresolved product decisions remain. SPEC 003 uses room-level Wave, self-controlled Raise Hand, and defers automatic AFK and reaction audio.
