---

description: "Dependency-ordered implementation tasks for SPEC 004 Video Effects Pipeline"
---

# Tasks: Video Effects Pipeline

**Input**: Design documents from `/specs/004-video-effects-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are required by the specification and plan. Within each story, write the listed tests first and confirm they fail for the intended reason before implementation.

**Organization**: Tasks are grouped by user story. P1 stories are ordered by architectural dependency: raw safety, backgrounds, lifecycle, then orientation/isolation. P2 personalization and degradation follow the stable foundation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable because it targets a different file and has no dependency on an incomplete task in the same phase
- **[Story]**: Maps to the numbered user story in `spec.md`
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the approved client-only dependency and feature structure without loading effects in the room startup path.

- [X] T001 Add a pinned `@mediapipe/tasks-vision` dependency and lockfile resolution in `frontend/package.json` and `frontend/pnpm-lock.yaml`
- [X] T002 Create the browser-only effect module barrel and directory boundary in `frontend/src/features/room/effects/index.ts`
- [X] T003 [P] Create versioned placeholder directories and provenance README covering source URL, hash, license, and notices in `frontend/public/effects/README.md`, `frontend/public/effects/models/.gitkeep`, and `frontend/public/effects/ar/.gitkeep`
- [X] T004 Verify and document the exact package, WASM, model, and visual-asset licenses before adding binaries in `frontend/public/effects/THIRD_PARTY_NOTICES.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish one typed state model and one lifecycle owner before any effect implementation.

**⚠️ CRITICAL**: All tasks in this phase block every user story.

- [X] T005 [P] Define `EffectSelection` with background exactly `none|blur|custom`, look exactly `natural|warm|monochrome`, AR exactly `none|glasses|cat-ears|mask|face-paint|animated-fun`, opaque optional custom background ID, and increasing generation in `frontend/src/features/room/effects/contracts.ts`
- [X] T006 [P] Define processor/capability states exactly `inactive|loading|active|unavailable|failed|fallback` and `idle|loading|ready|unavailable|failed|circuit-open`, quality tiers `high|medium|low|off`, camera source identity, and bounded fallback reasons in `frontend/src/features/room/effects/contracts.ts`
- [X] T007 [P] Define the closed application-owned effect catalog, labels, required static asset paths, and safe default selection in `frontend/src/features/room/effects/effectCatalog.ts`
- [X] T008 [P] Write failing unit tests for unknown-ID normalization and exact conditional capability derivation (segmentation only Blur/Custom, landmarks only AR, color only Warm/Monochrome, animation only when reduced motion is false) in `frontend/src/features/room/effects/effectCapabilities.test.ts`
- [X] T009 Implement selection normalization and pure `RequiredCapabilities` derivation in `frontend/src/features/room/effects/effectCapabilities.ts`
- [X] T010 [P] Write failing store tests for desired/runtime separation, monotonically increasing generation, truthful loading/active/fallback status, and no local/session/durable persistence in `frontend/src/stores/useVideoEffectsStore.test.ts`
- [X] T011 Implement the participant-local Zustand desired/runtime state and reset action without media operations or persistence in `frontend/src/stores/useVideoEffectsStore.ts`
- [X] T012 Define injectable interfaces for clock, frame scheduler, vision runtime, compositor, image decoder, and LiveKit processor host in `frontend/src/features/room/effects/runtimeContracts.ts`
- [X] T013 Add bounded privacy-safe effect error formatting that never exposes model URLs, image contents, paths, landmarks, or raw exceptions in `frontend/src/features/room/effects/effectErrors.ts`

**Checkpoint**: Typed local state is the sole effect-selection truth; no room, server, or media behavior has changed.

---

## Phase 3: User Story 1 - Keep the basic camera reliable (Priority: P1) 🎯 MVP

**Goal**: Preserve the existing raw camera and attach one optional processor that always fails back safely without affecting microphone, room, or chat.

**Independent Test**: Join and use camera without effects, then force processor initialization/output failure; raw camera, microphone, screen share, chat, and room remain usable and no vision runtime starts while effects are off.

### Tests for User Story 1

- [ ] T014 [P] [US1] Write failing processor tests for effects-off zero initialization, one unmirrored output track, idempotent destroy, and raw fallback on initialization/runtime failure in `frontend/src/features/room/effects/effectProcessor.test.ts`
- [ ] T015 [P] [US1] Write failing controller tests for exactly one processor attachment, SDK raw restoration, and partial/total failure reporting in `frontend/src/features/room/effects/effectController.test.ts`
- [ ] T016 [P] [US1] Extend media-session tests to prove processor failure does not toggle/recreate microphone, screen share, Room, or application WebSocket in `frontend/src/features/room/mediaSession.test.ts`

### Implementation for User Story 1

- [X] T017 [US1] Implement one LiveKit-compatible video processor shell with one canvas output, browser-only initialization, raw-safe destroy, and no vision loading when `needsProcessor=false` in `frontend/src/features/room/effects/effectProcessor.ts`
- [X] T018 [US1] Implement the single serialized controller owner for attach/update/stop/destroy using current `LocalVideoTrack.setProcessor()` and `stopProcessor()` in `frontend/src/features/room/effects/effectController.ts`
- [X] T019 [US1] Integrate one controller instance with the existing local camera publication in `LiveMediaContext`, preserving existing camera/mic/screen toggles and teardown ordering in `frontend/src/features/room/RoomSession.tsx`
- [X] T020 [US1] Route bounded effect fallback messages through existing media error presentation without exposing raw errors in `frontend/src/features/room/RoomSession.tsx`
- [X] T021 [US1] Run the US1 Vitest files and verify the effects-off room path performs no dynamic MediaPipe import in `frontend/src/features/room/effects/effectProcessor.test.ts`, `frontend/src/features/room/effects/effectController.test.ts`, and `frontend/src/features/room/mediaSession.test.ts`

**Checkpoint**: The raw-camera MVP is independently releasable; optional processor failure cannot take down basic media.

---

## Phase 4: User Story 2 - Personalize a camera background (Priority: P1)

**Goal**: Add local Blur and safe Custom Background with conditional segmentation and deterministic image cleanup.

**Independent Test**: Apply Blur and one valid local image, observe from a remote peer, return to None, and reject corrupt/unsupported/oversized inputs without camera interruption or upload.

### Tests for User Story 2

- [X] T022 [P] [US2] Write failing custom-image tests for MIME+decode validation, JPEG/PNG/WebP acceptance, SVG/animated/corrupt rejection, encoded size ≤8 MiB, width/height each ≤4096, opaque IDs, stale decode, replacement, and one-time URL revocation in `frontend/src/features/room/effects/customBackground.test.ts`
- [ ] T023 [P] [US2] Write failing compositor tests for None passthrough, foreground-preserving Blur, Custom image placement, unmirrored output, and resource release in `frontend/src/features/room/effects/compositor.test.ts`
- [ ] T024 [P] [US2] Write failing MediaPipe wrapper tests for lazy segmentation initialization, one inference in flight, skipped busy frames, close-on-disable, and safe load/runtime failure in `frontend/src/features/room/effects/mediaPipeRuntime.test.ts`

### Implementation for User Story 2

- [X] T025 [US2] Implement custom-image decode/validation with the exact 8 MiB and 4096×4096 limits, draw-only pixel source, opaque IDs, abort/generation checks, and idempotent disposal in `frontend/src/features/room/effects/customBackground.ts`
- [X] T026 [US2] Implement lazy same-origin MediaPipe runtime loading and segmentation lifecycle with one in-flight inference and explicit close in `frontend/src/features/room/effects/mediaPipeRuntime.ts`
- [X] T027 [US2] Implement one canvas compositor for raw, Blur, and Custom background using unmirrored source coordinates in `frontend/src/features/room/effects/compositor.ts`
- [X] T028 [US2] Wire segmentation and custom-image resources into processor config updates so None releases segmentation/image work without camera reconnect in `frontend/src/features/room/effects/effectProcessor.ts`
- [X] T029 [US2] Add minimal Background selection and local-only preview/apply flow needed to independently exercise None/Blur/Custom in `frontend/src/components/room/VideoEffectsPanel.tsx`
- [X] T030 [US2] Add English/Vietnamese Background, validation, loading, and fallback strings to `frontend/src/lib/i18n/uiText.ts`

**Checkpoint**: Backgrounds work independently; valid output reaches remote peers while inputs and frames remain local.

---

## Phase 5: User Story 4 - Change effects safely during a live call (Priority: P1)

**Goal**: Make rapid switching, camera on/off, device replacement, reconnect, visibility changes, leave, and rejoin latest-wins and leak-free.

**Independent Test**: Repeat rapid selections and 20 full lifecycle cycles; final state matches the latest selection, one publication exists when on, and tracks/tasks/listeners/URLs/canvases stabilize.

### Tests for User Story 4

- [ ] T031 [P] [US4] Write failing 100-sequence latest-wins tests for stale model load, stale image decode, stale processor init, and stale restart completion in `frontend/src/features/room/effects/effectController.race.test.ts`
- [ ] T032 [P] [US4] Write failing lifecycle tests for camera off/on, source replacement, reconnect, background/foreground, disposal during load, and repeated idempotent cleanup in `frontend/src/features/room/effects/effectController.lifecycle.test.ts`
- [ ] T033 [P] [US4] Extend integration tests for one publication and no mic recreation across camera switch/reconnect in `frontend/src/features/room/mediaSession.test.ts`

### Implementation for User Story 4

- [X] T034 [US4] Implement monotonic generation ownership, one serialized reconciliation chain, post-await owner/source checks, and abortable loader coordination in `frontend/src/features/room/effects/effectController.ts`
- [X] T035 [US4] Implement processor `restart` for a replacement raw camera source without creating another output loop or publication in `frontend/src/features/room/effects/effectProcessor.ts`
- [X] T036 [US4] Reconcile controller ownership against current local camera publication during camera on/off, SDK track restart/replacement, and reconnect in `frontend/src/features/room/RoomSession.tsx`
- [X] T037 [US4] Add bounded foreground/background pause-and-reconcile behavior without changing SPEC 003 presence state in `frontend/src/features/room/effects/effectController.ts`
- [X] T038 [US4] Implement terminal teardown ordering for loaders, inference, frame callbacks, processed track, tasks, canvas, listeners, and image URLs in `frontend/src/features/room/effects/effectController.ts`

**Checkpoint**: Realtime lifecycle is race-safe and resource ownership remains bounded under repeated transitions.

---

## Phase 6: User Story 5 - Preserve orientation and isolate media types (Priority: P1)

**Goal**: Guarantee correct local/remote front/rear orientation and strict camera-only processing.

**Independent Test**: Compare readable text and AR anchors in local/remote front and rear views, then screen-share while effects run; only local front self-view is mirrored and mic/screen remain untouched.

### Tests for User Story 5

- [X] T039 [P] [US5] Add failing orientation tests for local front mirror, remote unmirrored output, rear unmirrored output, and unknown-facing safe behavior in `frontend/src/features/room/cameraOrientation.test.ts`
- [ ] T040 [P] [US5] Add failing processor input-guard tests rejecting microphone and screen-share sources while accepting only the current local camera video source in `frontend/src/features/room/effects/effectProcessor.test.ts`
- [ ] T041 [P] [US5] Extend Stage layout tests to prove effects do not alter screen-share ownership/layout in `frontend/src/features/room/stageLayout.test.ts`

### Implementation for User Story 5

- [X] T042 [US5] Extract and type the existing presentation-only camera-facing/mirror decision without changing behavior in `frontend/src/features/room/cameraOrientation.ts` and use it from `frontend/src/features/room/RoomSession.tsx`
- [X] T043 [US5] Enforce camera-source-only guards and unmirrored compositor coordinates in `frontend/src/features/room/effects/effectProcessor.ts` and `frontend/src/features/room/effects/compositor.ts`
- [X] T044 [US5] Verify screen-share and microphone controls bypass all effect state/controller paths in `frontend/src/features/room/RoomSession.tsx`

**Checkpoint**: Orientation and media isolation are independently verifiable and release-blocking checks pass.

---

## Phase 7: User Story 3 - Apply lightweight looks and playful AR (Priority: P2)

**Goal**: Complete Natural/Warm/B&W, five playful AR choices, one reduced-motion-aware animated effect, and the final accessible compact UI.

**Independent Test**: Apply every Look/AR and Blur+Warm+Glasses; only required detectors run, anchors follow normal motion, one processed publication exists, and UI states are truthful/accessibly operable.

### Tests for User Story 3

- [ ] T045 [P] [US3] Write failing compositor tests for zero-cost Natural, Warm, B&W, each AR overlay anchor, Background→Look→AR ordering, and reduced-motion animated behavior in `frontend/src/features/room/effects/compositor.test.ts`
- [ ] T046 [P] [US3] Extend MediaPipe tests for lazy face-landmark initialization, one in-flight inference, AR-only no segmentation, and isolated landmark failure in `frontend/src/features/room/effects/mediaPipeRuntime.test.ts`
- [ ] T047 [P] [US3] Write failing UI tests for all single-selection groups, selected/loading/active/fallback/unavailable truth, keyboard controls, Escape/focus return, touch labels, static thumbnails, and silent selection in `frontend/src/components/room/VideoEffectsPanel.test.tsx`

### Implementation for User Story 3

- [X] T048 [P] [US3] Add original or explicitly licensed optimized transparent AR assets with provenance entries in `frontend/public/effects/ar/` and `frontend/public/effects/THIRD_PARTY_NOTICES.md`
- [X] T049 [US3] Implement face-landmark lazy lifecycle and result normalization in `frontend/src/features/room/effects/mediaPipeRuntime.ts`
- [X] T050 [US3] Implement Warm/B&W transforms and app-defined Glasses, Cat ears, Mask, Face paint, and Animated Fun overlays in deterministic Background→Look→AR order in `frontend/src/features/room/effects/compositor.ts`
- [X] T051 [US3] Implement the complete accessible desktop popover/mobile bottom-sheet UI without permanent sidebar or per-thumbnail pipelines in `frontend/src/components/room/VideoEffectsPanel.tsx`
- [X] T052 [US3] Add a separate adjacent Video Effects disclosure while preserving the camera button's toggle action and Stage-first dock hierarchy in `frontend/src/features/room/RoomView.tsx`
- [X] T053 [US3] Add all English/Vietnamese Looks, Fun, status, accessibility, and reduced-motion strings in `frontend/src/lib/i18n/uiText.ts`

**Checkpoint**: The intended small effects library composes correctly and is usable without compromising the Stage.

---

## Phase 8: User Story 6 - Use effects on varied devices without harming the call (Priority: P2)

**Goal**: Add capability-based availability, bounded performance tiers, weak-device fallback, and privacy-safe diagnostics.

**Independent Test**: Join without model downloads, then simulate slow frames, unsupported capabilities, repeated errors, context loss, orientation/memory pressure, and recovery; effects degrade before audio/camera and never loop.

### Tests for User Story 6

- [X] T054 [P] [US6] Write failing capability tests for secure context, camera, canvas capture, WASM, graphics support, and per-effect unsupported results without user-agent allowlists in `frontend/src/features/room/effects/effectCapabilities.test.ts`
- [X] T055 [P] [US6] Write failing performance tests for fixed-size samples, High/Medium/Low/Off transitions, sustained-pressure threshold, ≥15-second hysteresis, skipped-frame accounting, and two-error capability circuit breaker in `frontend/src/features/room/effects/performanceMonitor.test.ts`
- [ ] T056 [P] [US6] Write failing context-loss and recovery tests proving one bounded recovery and raw/healthy-subset fallback in `frontend/src/features/room/effects/effectProcessor.test.ts`

### Implementation for User Story 6

- [X] T057 [US6] Implement capability-based availability and SSR-safe browser checks without importing heavy runtime on room join in `frontend/src/features/room/effects/effectCapabilities.ts`
- [X] T058 [US6] Implement bounded rolling metrics, tier policy, 15-second hysteresis, and per-capability circuit breaker in `frontend/src/features/room/effects/performanceMonitor.ts`
- [X] T059 [US6] Apply High ≤1280×720@30, Medium ≤960×540@20–24, Low ≤640×360@12–15, and Off raw-camera policies plus reduced inference cadence in `frontend/src/features/room/effects/effectProcessor.ts`
- [X] T060 [US6] Implement one bounded rendering-context recovery and privacy-safe fallback diagnostics with no per-frame logging in `frontend/src/features/room/effects/effectProcessor.ts`
- [X] T061 [US6] Surface unsupported/degraded/circuit-open states with calm truthful UI feedback in `frontend/src/components/room/VideoEffectsPanel.tsx`

**Checkpoint**: Weak or unsupported devices retain the call and raw camera; expensive code remains lazy.

---

## Phase 9: Polish & Cross-Cutting Verification

**Purpose**: Complete documentation, regression gates, real-browser verification, privacy checks, and resource stabilization.

- [X] T062 [P] Update actual implemented client pipeline, fallback tiers, cleanup, and single-runtime decision in `docs/media-processing.md` and `docs/video-effects.md`
- [X] T063 [P] Update processor integration, raw restoration, orientation, and real-device matrix guidance in `docs/livekit.md` and `docs/testing-strategy.md`
- [X] T064 Audit all model/WASM/AR binaries against recorded source, version, hash, and license notices in `frontend/public/effects/README.md` and `frontend/public/effects/THIRD_PARTY_NOTICES.md`
- [X] T065 Run `pnpm test` from `frontend/` and record exact results in `specs/004-video-effects-pipeline/verification.md`
- [X] T066 Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` from `frontend/` and record exact results in `specs/004-video-effects-pipeline/verification.md`
- [ ] T067 Perform Chrome desktop two-peer raw/background/look/AR/composition, local/remote orientation, mic/screen isolation, camera switch, and reconnect checks from `specs/004-video-effects-pipeline/quickstart.md` and record evidence in `specs/004-video-effects-pipeline/verification.md`
- [ ] T068 Perform invalid-image, model failure, context-loss, weak-device degradation, 20-cycle cleanup, and HTTP/WebSocket privacy inspection from `specs/004-video-effects-pipeline/quickstart.md` and record evidence in `specs/004-video-effects-pipeline/verification.md`
- [ ] T069 [P] Execute Chrome Android and Safari iOS mobile flip/orientation/background-foreground checks where devices are available, marking every unexecuted case NOT VERIFIED in `specs/004-video-effects-pipeline/verification.md`
- [X] T070 Review the final diff to confirm no backend, database migration, Redis, WebSocket protocol, persistent preference key, screen-share behavior, microphone behavior, or SPEC 001–003 contract changed unintentionally and document the result in `specs/004-video-effects-pipeline/verification.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: starts immediately.
- **Foundational (Phase 2)**: depends on Setup and blocks every story.
- **US1 (Phase 3)**: first releasable raw-safety increment after Foundation.
- **US2 (Phase 4)**: depends on US1 processor/controller shell.
- **US4 (Phase 5)**: depends on US1 controller and US2 asynchronous resource paths so race tests cover real loaders.
- **US5 (Phase 6)**: depends on US1 processor integration; scheduled after US4 so source replacement is stable.
- **US3 (Phase 7)**: depends on US2 composition and US4 lifecycle; can begin after both, while US5 tests may proceed in parallel on separate files.
- **US6 (Phase 8)**: depends on the complete processor graph and lifecycle.
- **Polish (Phase 9)**: depends on all selected stories.

### User Story Graph

```text
Setup → Foundation → US1
                       ├→ US2 → US4 → US3 → US6
                       └────────→ US5 ───────┘
```

### Parallel Opportunities

- T003 can run alongside T001–T002; T005–T008 and T010 are different-file foundational work.
- Test tasks marked [P] within each story can be authored concurrently before implementation.
- After US1, early US5 orientation test extraction can proceed alongside US2 where file conflicts are avoided.
- AR asset provenance T048 can proceed alongside landmark/compositor work after catalog contracts are stable.
- Documentation pairs T062 and T063 and optional mobile verification T069 can run independently of each other after implementation.

## Parallel Examples

### US2

```text
T022 customBackground.test.ts
T023 compositor.test.ts
T024 mediaPipeRuntime.test.ts
```

### US4

```text
T031 effectController.race.test.ts
T032 effectController.lifecycle.test.ts
T033 mediaSession.test.ts
```

### US3

```text
T045 compositor.test.ts
T046 mediaPipeRuntime.test.ts
T047 VideoEffectsPanel.test.tsx
T048 licensed AR assets/provenance
```

## Implementation Strategy

### MVP First

1. Complete Setup and Foundation.
2. Complete US1 only.
3. Stop and validate effects-off, optional processor failure, raw fallback, and mic/screen/chat independence.
4. Do not expose effect controls broadly until US2 and US4 lifecycle tests pass.

### Incremental Delivery

1. **Raw-safe foundation**: US1.
2. **Useful background slice**: US2.
3. **Production-safe lifecycle**: US4.
4. **Orientation/media boundary**: US5.
5. **Playful library and final UI**: US3.
6. **Adaptive weak-device behavior**: US6.
7. **Release verification**: Phase 9.

## Notes

- Never add a second Room, camera manager, publication owner, or effect WebSocket event.
- Never commit model or AR binaries without T004/T064 provenance and license evidence.
- Tests must fail for the expected missing behavior before implementation.
- Keep unrelated dirty worktree changes intact.
- Commit after each task or coherent task group; stop at checkpoints for independent validation.
