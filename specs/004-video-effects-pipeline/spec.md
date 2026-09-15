# Feature Specification: Video Effects Pipeline

**Feature Branch**: `[004-video-effects-pipeline]`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Create MVP3 / SPEC 004 — Video Effects Pipeline for the existing Mingly application."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep the basic camera reliable (Priority: P1)

As a participant, I can use Mingly's existing camera normally without enabling effects, and an unavailable or failed effect never prevents me from continuing the call with the raw camera when the camera itself still works.

**Why this priority**: Effects are optional. Call audio and the baseline camera experience are more important than visual customization.

**Independent Test**: Join a room, use the camera without opening effects, then simulate effect initialization and rendering failures; verify that the room, microphone, raw camera, and existing media controls remain usable.

**Acceptance Scenarios**:

1. **Given** a participant enables the camera with all effects off, **when** the camera publishes, **then** the existing raw-camera path is used and no segmentation or face tracking starts.
2. **Given** the physical camera works but an effect cannot initialize, **when** the failure occurs, **then** the affected effect becomes unavailable or falls back while the call and raw camera remain active.
3. **Given** an AR effect fails while a healthy background effect is active, **when** failure isolation runs, **then** the AR effect stops, the healthy background effect may continue, and the camera is not unnecessarily reduced to a less capable path.
4. **Given** WebGL or another rendering context is lost, **when** recovery is attempted, **then** retrying is bounded and the camera falls back safely if recovery is not possible.
5. **Given** camera permission is denied or revoked, **when** an effect is selected, **then** the UI does not claim it is active, repeated permission prompts do not loop, and the room and independent microphone remain usable.

---

### User Story 2 - Personalize a camera background (Priority: P1)

As a participant, I can leave my background unchanged, blur it, or replace it with a local image while remaining visible in the foreground and without uploading live camera content or my chosen image to Mingly.

**Why this priority**: Background control provides the broadest practical value while preserving privacy through local processing.

**Independent Test**: Apply Blur and a valid custom image to one local camera, observe the result locally and from a second participant, then return to None and verify processing stops without reconnecting the room.

**Acceptance Scenarios**:

1. **Given** a participant has a working camera, **when** Background Blur is selected, **then** the participant remains foregrounded, the background is blurred, remote participants see the processed camera, and the microphone is unaffected.
2. **Given** Blur is active, **when** Background None is selected, **then** the raw background returns, segmentation no longer consumes resources, and the camera does not reconnect solely because blur was disabled.
3. **Given** a participant selects a valid supported local image and confirms it, **when** Custom Background becomes active, **then** the image appears behind the segmented participant and neither the image nor camera frames are automatically uploaded.
4. **Given** an image is corrupt, invalid, unsafe, too large for safe use, or fails decoding, **when** it is selected, **then** it is rejected with calm feedback, no executable content runs, and the camera remains usable.
5. **Given** Custom Background A is replaced by B and then None, **when** each change completes, **then** only the newest selection is active and resources belonging to prior images are released.

---

### User Story 3 - Apply lightweight looks and playful AR (Priority: P2)

As a participant, I can combine one subtle visual look and one playful face-tracked effect with my chosen background, receiving immediate feedback without turning the room into a video editor.

**Why this priority**: Looks and AR add social expression after the reliable camera and background foundation is secured.

**Independent Test**: Apply Natural, Warm, and Black & White separately; apply each supported AR effect; then combine Blur + Warm + Glasses and verify one correct processed camera publication.

**Acceptance Scenarios**:

1. **Given** only Warm or Black & White is selected, **when** it becomes active, **then** the look is applied without starting segmentation or face tracking solely for that look.
2. **Given** Natural is visually equivalent to the raw camera, **when** it is selected, **then** no unnecessary processing runs and no facial or body reshaping occurs.
3. **Given** Glasses, Cat ears, Mask, Face paint, or the single lightweight animated effect is selected, **when** the participant moves normally, **then** the selected effect remains reasonably aligned with the face and remote participants see the final result.
4. **Given** an AR effect is active without a background effect, **when** processing runs, **then** face tracking may run but segmentation does not.
5. **Given** Blur + Warm + Glasses is selected, **when** the effects compose, **then** one Background, one Look, and one AR effect are applied in a bounded pipeline with exactly one valid camera publication.
6. **Given** reduced motion is enabled, **when** the animated effect or Effects UI is used, **then** nonessential motion is reduced without changing camera or call lifecycle.

---

### User Story 4 - Change effects safely during a live call (Priority: P1)

As a participant, I can rapidly change effects, turn the camera off and on, switch cameras, reconnect, or leave without stale selections, duplicated tracks, interrupted audio, or leaked processing resources.

**Why this priority**: Lifecycle and race correctness determine whether optional effects can safely coexist with a realtime call.

**Independent Test**: Repeat rapid selection, camera toggling, device switching, reconnect, browser background/foreground, leave, and rejoin cycles while checking that the newest state wins and resource counts stabilize.

**Acceptance Scenarios**:

1. **Given** Blur is still loading, **when** the participant selects None before loading finishes, **then** None remains authoritative and the late Blur result cannot reactivate itself.
2. **Given** Glasses is loading, **when** Mask is selected and Glasses finishes later, **then** Mask remains the selected target and stale resources are cleaned.
3. **Given** an effect is selected, **when** the camera is turned off and then on, **then** unnecessary processing stops while off, the valid selection restores where supported, and only one camera publication exists.
4. **Given** Blur is selected on Camera A, **when** Camera B is selected, **then** Camera B becomes the source, Blur remains conceptually selected, Camera A is released, and no room reconnect or duplicate publication occurs.
5. **Given** an effect is active on a mobile front camera, **when** the participant flips to the rear camera, **then** the source and mirror presentation update correctly and the effect remains active only if supported.
6. **Given** camera and an effect are active, **when** a temporary network interruption recovers, **then** existing reconnect authority is preserved, selection may restore safely, and no duplicate track or processor remains.
7. **Given** the browser is backgrounded and then foregrounded, **when** media resumes, **then** current camera state is reconciled without duplicate sources or processors; browser visibility alone does not change SPEC 003 presence state.
8. **Given** the participant leaves the room or the owning UI lifecycle ends, **when** cleanup completes, **then** camera processing, workers, animation loops, listeners, temporary image resources, and obsolete tracks stop.

---

### User Story 5 - Preserve orientation and isolate media types (Priority: P1)

As a participant, I see a natural mirrored self-view from my front camera while others receive correctly oriented processed video, and neither screen sharing nor microphone media is altered by video effects.

**Why this priority**: Incorrect mirroring and cross-track processing are visible correctness failures that can also destabilize unrelated media.

**Independent Test**: Use front and rear cameras with every effect category and a combined selection, compare local and remote orientation, then start screen sharing and verify the screen and audio paths remain unchanged.

**Acceptance Scenarios**:

1. **Given** a front-camera self-view with Glasses, **when** viewed locally and remotely, **then** local presentation follows Mingly's mirror rule, remote video remains unmirrored, and the glasses stay aligned in both views.
2. **Given** a rear camera with any supported effect, **when** viewed locally and remotely, **then** neither view is accidentally mirrored.
3. **Given** Blur is active and screen sharing starts, **when** both camera and screen tracks are visible, **then** only the camera may be processed, the screen share remains unmirrored, and existing Stage ownership and layout remain intact.
4. **Given** any effect initializes, switches, fails, or stops, **when** the transition completes, **then** it does not mute, recreate, or unnecessarily restart the microphone.

---

### User Story 6 - Use effects on varied devices without harming the call (Priority: P2)

As a participant on desktop or mobile, I receive a responsive effects experience that loads expensive capabilities only when requested and degrades or disables effects before harming audio or basic camera stability.

**Why this priority**: Device capability varies widely, and graceful degradation protects the core hangout experience.

**Independent Test**: Join without using effects, then activate effects under constrained performance, failed model loading, orientation changes, and memory pressure; verify lightweight startup and bounded fallback.

**Acceptance Scenarios**:

1. **Given** a participant never uses effects, **when** joining and using a room, **then** heavy effect capabilities and models are not initialized unnecessarily and normal joining is not blocked by them.
2. **Given** a device cannot sustain a requested effect, **when** sustained resource pressure is detected, **then** effect quality reduces or the raw camera is restored before call audio or basic camera availability is sacrificed.
3. **Given** a capability is unsupported, **when** the participant selects the related effect, **then** calm feedback explains that it is unavailable on this device and no crash or retry loop occurs.
4. **Given** orientation, memory pressure, browser suspension, or thermal throttling changes device conditions, **when** the pipeline adapts, **then** it remains bounded and preserves the latest valid user selection or falls back safely.

### Edge Cases

- The participant selects effects while the camera is off, permission is pending, or no camera exists.
- An older asynchronous model or image decode completes after a newer selection, camera source, room session, or component lifecycle has replaced it.
- Segmentation succeeds while face tracking fails, or vice versa, during a combined effect.
- The selected custom image has misleading metadata, extreme dimensions, unsupported encoding, corrupt bytes, or exceeds a safe decode/memory budget.
- A temporary image is replaced or the room closes while decoding is still pending.
- The rendering context is lost repeatedly, or recovery succeeds after the user has disabled the associated effect.
- A camera track ends externally, permission is revoked, or the selected device disappears while processing is active.
- The participant flips cameras or rotates a mobile device while an effect is initializing.
- LiveKit reconnects while the browser is backgrounded or while an effect is falling back.
- Screen share begins or ends while the camera pipeline is transitioning.
- Opening and closing the Effects UI repeatedly must not create processing pipelines; closing it does not disable a currently active effect.
- Effect thumbnails must not each acquire a camera or start independent realtime detection.
- Repeated camera/effect/leave/rejoin cycles must stabilize rather than accumulate tracks, models, contexts, loops, workers, timers, listeners, or temporary image resources.

## Requirements *(mandatory)*

### Existing System Baseline and Ownership

- The existing frontend owns camera, microphone, screen-share, and room-media lifecycle through one LiveKit room session. Camera and microphone are toggled through the existing local participant, and screen share has a separate path.
- The current camera path is raw and has no installed effects processor or computer-vision dependency. Effects must therefore extend this path rather than replace it or create a parallel media manager.
- Existing media defaults enable adaptive delivery, dynamic publication behavior, multi-quality video, 720p camera capture, and presentation-layer mirroring for the local front-camera self-view.
- LiveKit remains authoritative for WebRTC media transport and actual track state. The application WebSocket remains a typed control plane; no new effect events are needed for remote rendering.
- Current session-scoped media preferences cover microphone and camera restoration. Long-term effect and custom-background preferences are deferred to SPEC 006 unless an already-owned preference boundary is confirmed during planning.
- Existing participant tiles, Stage layouts, room reconnect behavior, media error handling, permission flow, and SPEC 001–003 behavior are preserved.

### Functional Requirements

- **FR-001**: The system MUST offer exactly one selected Background (`None`, `Blur`, or `Custom`), one selected Look (`Natural`, `Warm`, or `Black & White`), and one selected AR effect (`None`, `Glasses`, `Cat ears`, `Mask`, `Face paint`, or one lightweight animated effect).
- **FR-002**: The system MUST NOT support multiple simultaneous AR effects, arbitrary effect graphs, executable user-authored effects, effect marketplaces, or paid effect packs in SPEC 004.
- **FR-003**: Effects MUST apply only to the participant's own camera and MUST NOT be forceable by another participant.
- **FR-004**: All camera-frame processing, person segmentation, face tracking, and composition MUST remain on the participant's device.
- **FR-005**: Camera frames, face landmarks, segmentation masks, face geometry, biometric templates, and custom image contents MUST NOT be sent to or persisted by the Mingly backend, application WebSocket, Redis, PostgreSQL, or Supabase storage for this feature.
- **FR-006**: The system MUST NOT perform face recognition, identity recognition, demographic inference, emotion inference, beauty scoring, facial reshaping, or body reshaping/tracking.
- **FR-007**: Effects-off behavior MUST preserve the existing raw-camera publication path without running segmentation or face tracking.
- **FR-008**: If optional processing fails while the physical camera remains usable, the system MUST preserve compatible healthy effects where safe or fall back to raw camera without ending the room or interrupting audio.
- **FR-009**: Background None MUST perform no background transformation and MUST stop or release background-processing resources no longer needed.
- **FR-010**: Background Blur MUST preserve the participant foreground and blur the background locally at a quality that yields before call stability.
- **FR-011**: Custom Background MUST let the participant choose, preview, apply, replace, and remove a supported local image without exposing its local filesystem path or automatically uploading it.
- **FR-012**: Custom image validation MUST reject unsupported, corrupt, unsafe, or excessive inputs before they can cause unbounded decode or memory work; exact supported formats and limits are planning decisions.
- **FR-013**: Temporary image and decoding resources MUST be released when replaced, cancelled, disabled, failed, or no longer owned by the active room lifecycle.
- **FR-014**: Natural MUST remain subtle and MUST avoid processing when it is equivalent to the raw camera.
- **FR-015**: Warm and Black & White MUST use only the lightweight visual processing they need and MUST NOT start segmentation or face tracking solely for a color look.
- **FR-016**: An optional Cool look MAY be included during planning only if it adds clear value without expanding lifecycle or performance risk.
- **FR-017**: Each AR effect MUST track normal face movement sufficiently to keep its intended visual anchored, without body or environment tracking.
- **FR-018**: The system MUST activate segmentation only for a selected background that needs it, face tracking only for a selected AR effect that needs it, and lightweight look processing only for a selected look that needs it.
- **FR-019**: Compatible Background, Look, and AR selections MUST compose into one final camera output and one valid camera publication.
- **FR-020**: The local self-view MUST show the actual active result with prompt feedback, without remounting the room or participant media tree solely for an effect change.
- **FR-021**: Remote participants MUST receive the sender's final processed camera through the existing media transport and MUST NOT load the sender's models, repeat processing, or receive effect instructions through the application control plane.
- **FR-022**: Front-camera mirroring MUST remain a local presentation concern; the published result and all remote camera views MUST remain correctly oriented and unmirrored.
- **FR-023**: Rear cameras and screen-share tracks MUST remain unmirrored, and effect coordinates MUST remain correct independently of local preview mirroring.
- **FR-024**: Effects MUST apply only to camera media and MUST NOT process, modify, remount, or redefine screen-share tracks or Stage screen-share behavior.
- **FR-025**: Effect transitions and failures MUST NOT mute, recreate, restart, process, or otherwise alter microphone media.
- **FR-026**: Camera-off MUST stop or pause unnecessary processing and preserve the existing avatar behavior; camera-on MUST attach the latest valid selection with exactly one camera publication.
- **FR-027**: A valid camera-device switch MUST preserve the conceptual selection where supported, attach processing to the new source, release the old source, and avoid a room reconnect.
- **FR-028**: Front/rear mobile camera changes MUST update source and mirroring correctly, preserve supported selections, and fall back calmly for unsupported combinations.
- **FR-029**: Existing browser camera permission handling and user-gesture constraints MUST remain authoritative; effects MUST NOT trigger permission loops or expose raw browser errors to users.
- **FR-030**: Existing reconnect and resynchronization behavior MUST remain authoritative, with at most one current camera source, processor pipeline, and publication after recovery.
- **FR-031**: The newest user selection and newest owning room/camera lifecycle MUST win over stale asynchronous initialization, model loading, image decoding, or recovery completion.
- **FR-032**: Heavy effect capabilities MUST be browser-only, safe during server rendering, lazy-loaded when needed, and MUST NOT block initial room joining for participants who do not use effects.
- **FR-033**: When device resources cannot sustain an effect, the system MUST reduce effect cost or disable processing before degrading audio stability or baseline camera availability.
- **FR-034**: Unsupported or failed effects MUST provide concise, calm, accessible feedback without crash loops or unbounded retries.
- **FR-035**: Browser background/foreground, orientation, suspension, memory pressure, and thermal changes MUST reconcile the current media state without treating visibility as presence or creating duplicate resources.
- **FR-036**: Opening, closing, or animating the Effects UI MUST NOT own or remount the LiveKit room, camera publication, or participant tiles; closing the UI MUST NOT disable the active effect.
- **FR-037**: The Effects UI MUST remain secondary to the Stage and use a compact popover, drawer, or mobile sheet rather than a permanent sidebar.
- **FR-038**: The Effects UI MUST support keyboard navigation, visible focus, accessible names, touch interaction, screen-reader semantics, and reduced motion.
- **FR-039**: Effect thumbnails or icons MUST NOT instantiate multiple live camera feeds, segmentation pipelines, or face trackers; one active realtime self-preview is sufficient.
- **FR-040**: The UI MUST distinguish selected configuration, processor status, and camera-track status, including inactive, loading, active, unavailable, failed, and fallback states, and MUST NOT claim an effect is active unless the processor is active.
- **FR-041**: Active effect selection MUST remain participant-local and MUST NOT introduce application WebSocket, Redis, PostgreSQL, or room-authoritative state solely to display processed video remotely.
- **FR-042**: SPEC 004 MUST NOT introduce long-term account persistence for preferred effects or custom backgrounds; that belongs to SPEC 006 unless planning confirms an existing suitable owner.
- **FR-043**: Effect selection MUST be silent and MUST NOT mix sound into microphone, participant audio, screen-share audio, or shared media.
- **FR-044**: On disable, source replacement, camera-off, room leave, owner cleanup, or unrecoverable failure, the system MUST release every no-longer-needed track, processor, model, rendering resource, canvas, animation loop, worker, timer, listener, temporary URL, and image resource.
- **FR-045**: Privacy-safe diagnostics MAY record bounded initialization timing, failures, fallbacks, unsupported capability, approximate processing rate, dropped processing frames, context loss, and cleanup failure, but MUST NOT emit per-frame telemetry or camera/biometric/image content.
- **FR-046**: Existing guest and authenticated join, persistent room access, passwords and locking, host lifecycle, moderation, reactions, presence, chat, reconnect, microphone, camera, device switching, screen sharing, Stage layouts, shared media, queue, themes, and multi-instance behavior MUST remain compatible.

### Key Entities *(include if feature involves data)*

- **Effect Selection**: Participant-local desired configuration containing one Background, one Look, and one AR choice; it is not room authority or durable account data in SPEC 004.
- **Processor Status**: Runtime truth for each required processing capability, including inactive, loading, active, unavailable, failed, or fallback, plus ownership by the current selection and camera lifecycle.
- **Camera Source**: The current physical camera track and its facing orientation; it remains distinct from the processed output and from screen-share media.
- **Processed Camera Output**: The single final camera track produced from compatible active effects and delivered through the existing media publication lifecycle.
- **Custom Background Resource**: A participant-selected local image and its temporary decode/preview resources, validated and owned only for the active local lifecycle.
- **Capability Profile**: A transient description of what the current browser/device can safely support, used to select bounded quality or raw fallback without identifying the participant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of effects-off test runs, the existing raw camera, microphone, screen share, join, reconnect, and leave behaviors remain unchanged and no expensive vision processor starts.
- **SC-002**: In all required effect-failure tests where the physical camera remains usable, the participant stays in the room and regains either the healthiest compatible effect composition or raw camera without microphone interruption.
- **SC-003**: For each Background, Look, AR, and supported combined selection, local and remote observers see the intended result within 2 seconds after already-available resources are ready, excluding first-time model download time.
- **SC-004**: Across 100 rapid-selection test sequences, the final visible and published state always matches the participant's latest selection, with zero stale reactivation and zero duplicate camera publications.
- **SC-005**: Across repeated camera off/on, camera switch, reconnect, browser lifecycle, leave, and rejoin cycles, owned tracks and processing resources return to a stable baseline rather than increasing with each cycle.
- **SC-006**: In 100% of front-camera, rear-camera, remote-camera, and screen-share orientation tests, local self-view and remote output follow Mingly's mirror rules and screen share is never mirrored or processed.
- **SC-007**: A participant who never enables effects can join and use the room without waiting for effect models or initializing segmentation or face tracking.
- **SC-008**: Under sustained weak-device conditions in the agreed test matrix, effects reduce quality or fall back before causing an audible call disruption attributable to the effects pipeline.
- **SC-009**: In 100% of privacy and network inspections, camera frames, face landmarks, segmentation masks, biometric data, and local custom-image contents remain on the participant's device and no new effect-state control messages are emitted.
- **SC-010**: All effect controls are operable with keyboard and touch, expose accessible names and visible focus, and remain understandable when reduced motion is enabled.
- **SC-011**: Invalid custom backgrounds, unavailable capabilities, model failures, and repeated rendering-context loss produce bounded, human-readable failure states with no crash or infinite retry loop.
- **SC-012**: Existing SPEC 001–003 acceptance suites and current media lifecycle checks continue to pass without behavior changes attributable to SPEC 004.

## Assumptions

- SPEC 004 extends the existing single LiveKit room and local-participant media lifecycle; it does not introduce a second camera manager, room connection, permission flow, or publication source of truth.
- The existing raw camera path, presentation-only local front-camera mirroring, unmirrored remote/rear/screen media, adaptive delivery, multi-quality publication, and Stage-first UI are the baseline to preserve.
- The repository currently has planned video-effects documentation but no installed vision/effects dependency or implemented processor; exact libraries, licensing verification, model delivery, rendering path, cancellation strategy, and media-track integration belong in planning.
- The initially supported library is intentionally limited to Background None/Blur/Custom, Looks Natural/Warm/Black & White, and AR Glasses/Cat ears/Mask/Face paint plus one lightweight animated effect.
- A Cool look is optional and may be omitted without reducing SPEC 004 completeness.
- Custom backgrounds are local session resources. Remembering them or the last selected effect across longer-lived account sessions belongs to SPEC 006 Profile & Preferences.
- Effects may degrade differently across supported browsers and devices, provided the UI reports the real state and raw camera fallback remains available.
- Exact image formats, byte/dimension limits, performance thresholds, supported-browser matrix, retry bounds, model choices, asset licensing, and automated/manual test tooling will be established in `$speckit-plan` after dependency and runtime inspection.
- Existing Astryx components, semantic tokens, light/dark/system themes, Stage-first responsive structure, motion timing, and media controls remain the visual foundation.
- No server, database, Redis, WebSocket protocol, Supabase, or LiveKit service changes are required merely to store or distribute active effect selections.

## Out of Scope

- Face or identity recognition, biometric profiles, demographic or emotion inference, beauty scoring, facial/body reshaping, body or full-environment tracking.
- Virtual avatars, AR marketplace, paid packs, arbitrary stacking, user-authored executable filters, arbitrary shaders/code, and effects forced by other participants.
- Server-side video processing; sending or storing camera frames, landmarks, masks, or active effect state through Go, application WebSocket, Redis, PostgreSQL, or Supabase.
- Screen-share effects, voice changers, audio effects, YouTube effects, video recording/editing, AI-generated live backgrounds, and room atmosphere.
- Long-term Profile & Preferences persistence, including remembered backgrounds, Looks, or AR selections.
- Replacing LiveKit, implementing custom WebRTC transport, redesigning Stage/ParticipantTile/ScreenShareLayout, or rewriting any SPEC 001–003 system.
