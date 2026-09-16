# Tasks: Room Atmosphere

**Input**: Design documents from `/specs/005-room-atmosphere/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are required because the specification defines measurable concurrency, security, accessibility, responsive, failure-isolation, and real-browser outcomes. Write each listed test before its implementation and confirm it fails for the intended reason.

**Organization**: Tasks are grouped by user story so each story remains an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it targets separate files and has no incomplete dependency
- **[Story]**: Maps the task to a user story in `spec.md`
- Every task includes an exact repository path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the migration and test surfaces without adding a parallel subsystem.

- [X] T001 Confirm migration `000006` is the next forward-only sequence and record the Room Appearance rollout/rollback assumptions in `specs/005-room-atmosphere/quickstart.md`
- [X] T002 [P] Add Room Atmosphere test fixtures/builders with Ambient + Blue + adaptive enabled defaults in `backend/internal/domain/domain_test.go`
- [X] T003 [P] Add typed frontend Room Appearance fixtures shared by store/component tests in `frontend/src/test/roomAppearanceFixtures.ts`
- [X] T004 [P] Add SPEC 005 Playwright project coverage tags and artifact retention conventions without changing existing browser projects in `frontend/playwright.config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the closed domain model, durable fields, public contract, and snapshot projection required by every story.

**⚠️ CRITICAL**: No user story implementation starts until this phase passes its domain, migration, serialization, and type tests.

- [X] T005 Add migration tests/inspection assertions for non-null defaults `atmosphere='ambient'`, `accent='blue'`, `adaptive_media_background=true`, closed-value constraints, and reversible column removal in `backend/internal/store/postgres_test.go`
- [X] T006 Add forward migration with the exact non-null defaults and allowlist checks from `data-model.md` in `backend/migrations/000006_room_appearance.up.sql`
- [X] T007 Add rollback migration that removes only SPEC 005 constraints/fields in `backend/migrations/000006_room_appearance.down.sql`
- [X] T008 Add closed `minimal|ambient|focus|party` and `blue|purple|green|orange|rose` domain types, validation, and Ambient + Blue + adaptive-enabled normalization in `backend/internal/domain/domain.go`
- [X] T009 Extend Room serialization and create/read/list/update SQL scans with Room Appearance while preserving legacy-safe defaults in `backend/internal/store/postgres.go`
- [X] T010 Add store interface operation for atomic full-appearance mutation guarded by room ID and expected existing Room version in `backend/internal/domain/domain.go`
- [X] T011 Add typed Room Appearance, Room fields, snapshot/event payload, and command payload definitions in `frontend/src/types/api.ts`
- [X] T012 Extend public Room/Room Preview responses to expose semantic appearance without CSS, URL, artwork, derived palette, or personal theme in `backend/internal/httpapi/server.go`
- [X] T013 Add HTTP serialization tests proving safe defaults and absence of private/styling fields in `backend/internal/httpapi/server_test.go`
- [X] T014 Extend room snapshot payload creation so initial, late-join, and reconnect bootstrap include full current appearance in `backend/internal/realtime/hub.go`
- [X] T015 Update baseline room snapshot fixtures and type/store tests for appearance defaults in `frontend/src/stores/useRoomStore.test.ts`

**Checkpoint**: Existing and new rooms have one validated durable appearance representation available in API and snapshots.

---

## Phase 3: User Story 1 - Share a Room Atmosphere (Priority: P1) 🎯 MVP

**Goal**: Current host selects one of four semantic atmospheres and every participant converges without communication-state changes.

**Independent Test**: Connect a host and participant, change through all four modes, attempt an unauthorized change, transfer host, and prove only authorized committed state propagates while call/media state remains unchanged.

### Tests for User Story 1

- [X] T016 [P] [US1] Add domain tests for all four valid modes, arbitrary-value rejection, current-host authorization, former-host rejection, and stale version conflict in `backend/internal/domain/domain_test.go`
- [X] T017 [P] [US1] Add realtime tests for typed command validation, no-I/O-under-lock mutation flow, success event, rejection reconciliation, host transfer, and non-blocking broadcast in `backend/internal/realtime/hub_test.go`
- [X] T018 [P] [US1] Add Redis two-hub delivery tests proving origin filtering, idempotent full-state propagation, and no persistent Redis authority in `backend/internal/realtime/redis_test.go`
- [X] T019 [P] [US1] Add frontend reducer/store tests that apply only newer appearance versions and replace stale local projection from snapshots in `frontend/src/stores/useRoomStore.test.ts`
- [X] T020 [P] [US1] Add room-settings tests for host-only four-mode selection, pending state, server rejection, and authoritative rollback in `frontend/src/components/room/RoomSettings.test.tsx`

### Implementation for User Story 1

- [X] T021 [US1] Implement atomic host-authorized durable appearance update with one Room version increment and no partial write in `backend/internal/store/postgres.go`
- [X] T022 [US1] Add `room.appearance.update` handling using current-host authority, expected version, durable I/O outside locks, and structured diagnostics in `backend/internal/realtime/hub.go`
- [X] T023 [US1] Publish and reconcile the complete `room.appearance.updated` state through the existing local/Redis room event path in `backend/internal/realtime/hub.go`
- [X] T024 [US1] Extend the existing realtime client with the typed appearance command/event and preserve protocol version/error handling in `frontend/src/lib/realtime.ts`
- [X] T025 [US1] Extend `useRoomStore` as the single frontend projection for snapshot/event appearance and version reconciliation in `frontend/src/stores/useRoomStore.ts`
- [X] T026 [US1] Add host-only Minimal/Ambient/Focus/Party controls to the existing in-room settings flow with pending/rejection reconciliation in `frontend/src/components/room/RoomSettings.tsx`
- [X] T027 [US1] Add localized concise labels and errors for atmosphere controls in `frontend/src/lib/i18n/types.ts`, `frontend/src/lib/i18n/dictionaries/en.ts`, `frontend/src/lib/i18n/dictionaries/vi.ts`, and `frontend/src/lib/i18n/uiText.ts`
- [X] T028 [US1] Add the stable Stage-shell atmosphere presentation layer without re-keying/remounting Stage, LiveKit tracks, or YouTube player in `frontend/src/features/room/RoomView.tsx`
- [X] T029 [US1] Add Playwright two-participant semantic-mode and unauthorized-change coverage using deterministic realtime fixtures in `frontend/e2e/spec005_room_atmosphere.spec.ts`

**Checkpoint**: The four shared modes work end to end; this is the suggested MVP slice.

---

## Phase 4: User Story 2 - Keep Personal Theme Independent (Priority: P1)

**Goal**: Room atmosphere composes with Light, Dark, and System without changing personal preference or bootstrap behavior.

**Independent Test**: Use different personal themes in the same Ambient room, change atmosphere and OS color mode, and prove the room and personal preferences remain independently stable.

### Tests for User Story 2

- [X] T030 [P] [US2] Add provider tests proving snapshots/events never overwrite `light|dark|system`, the `loft.theme` compatibility key, or system-theme response in `frontend/src/components/providers/ThemeProvider.test.tsx`
- [X] T031 [P] [US2] Add appearance composition tests covering every atmosphere in Light and Dark plus System changes in `frontend/src/features/room/RoomAtmosphere.test.tsx`

### Implementation for User Story 2

- [X] T032 [US2] Create a room-scoped semantic composition component that consumes room appearance but never writes document theme or localStorage in `frontend/src/features/room/RoomAtmosphere.tsx`
- [X] T033 [US2] Define reviewed light/dark semantic atmosphere mappings scoped to the room shell without combinatorial theme classes in `frontend/src/app/globals.css`
- [X] T034 [US2] Integrate room-scoped appearance beneath Stage content while preserving existing `ThemeProvider` ownership and hydration flow in `frontend/src/features/room/RoomView.tsx`
- [X] T035 [US2] Extend Playwright coverage for two participants with different Light/Dark/System modes and unchanged persisted preferences in `frontend/e2e/spec005_room_atmosphere.spec.ts`

**Checkpoint**: Atmosphere and application theme are independently functional and testable.

---

## Phase 5: User Story 3 - Give the Room a Restrained Accent (Priority: P2)

**Goal**: Host selects one of five safe decorative accents while product and semantic colors remain stable.

**Independent Test**: Select Blue, Purple, Green, Orange, and Rose; verify peer convergence and decorative change while danger, success, focus, and destructive controls remain unchanged and accessible.

### Tests for User Story 3

- [X] T036 [P] [US3] Add backend tests for the exact accent allowlist, arbitrary color/CSS/URL rejection, full-state events, and durable restore in `backend/internal/realtime/hub_test.go`
- [X] T037 [P] [US3] Add UI tests for all five options and stable semantic/focus tokens in `frontend/src/features/room/RoomAtmosphere.test.tsx`

### Implementation for User Story 3

- [X] T038 [US3] Add host accent selection to the existing appearance fieldset and send only allowlisted semantic values in `frontend/src/components/room/RoomSettings.tsx`
- [X] T039 [US3] Map the five accents to restrained decorative light/dark room variables while leaving product, danger, success, focus, and destructive tokens untouched in `frontend/src/app/globals.css`
- [X] T040 [US3] Apply accent only to room-shell/Stage atmosphere surfaces and never to arbitrary participant media or drawer ownership semantics in `frontend/src/features/room/RoomAtmosphere.tsx`
- [X] T041 [US3] Add Playwright accent convergence and semantic-control contrast assertions in `frontend/e2e/spec005_room_atmosphere.spec.ts`

**Checkpoint**: Persistent shared room personality works without arbitrary styling or semantic ambiguity.

---

## Phase 6: User Story 4 - Restore Atmosphere Reliably (Priority: P2)

**Goal**: Persistent, late-joining, reconnecting, transferred-host, concurrent, and multi-instance clients converge to current appearance.

**Independent Test**: Empty/reopen a styled room, reconnect after a change, join late, race mutations, and deliver an update across two hubs; every client resolves to the current durable version.

### Tests for User Story 4

- [X] T042 [P] [US4] Add PostgreSQL round-trip tests for empty-room persistence, process re-read, and atomic conflict behavior in `backend/internal/store/postgres_test.go`
- [X] T043 [P] [US4] Add snapshot/reconnect/late-join tests that recover current appearance without event replay in `backend/internal/realtime/leave_disconnect_test.go`
- [X] T044 [P] [US4] Add concurrent host mutation/transfer race tests and assert deterministic version convergence under `go test -race` in `backend/internal/realtime/hub_test.go`
- [X] T045 [P] [US4] Add cross-instance out-of-order event/snapshot tests that prevent stale overwrite in `backend/internal/realtime/redis_test.go`

### Implementation for User Story 4

- [X] T046 [US4] Re-read or reconcile committed appearance into each local room projection without holding realtime locks during PostgreSQL/Redis I/O in `backend/internal/realtime/hub.go`
- [X] T047 [US4] Ensure Redis relay carries only bounded full semantic appearance with origin filtering and existing outage behavior in `backend/internal/realtime/redis.go`
- [X] T048 [US4] Reconcile reconnect and late-join snapshots over stale optimistic/event state in `frontend/src/features/room/RoomSession.tsx`
- [X] T049 [US4] Add Playwright late-join, reconnect, stale rejection, and host-transfer appearance scenarios in `frontend/e2e/spec005_room_atmosphere.spec.ts`

**Checkpoint**: Appearance remains durable and convergent across lifecycle and topology changes.

---

## Phase 7: User Story 5 - Adapt Safely to Shared Media (Priority: P3)

**Goal**: Optionally derive a subtle client-only treatment once per active YouTube video and fall back without affecting playback.

**Independent Test**: Start/change/end media and inject fetch, CORS, decode, stale-generation, and analysis failures; verify bounded derivation, deterministic fallback, stale cleanup, and zero media/Stage remount.

### Tests for User Story 5

- [X] T050 [P] [US5] Add unit tests for approved YouTube thumbnail construction, bounded sampling, palette normalization, cancellation, one-result-per-video cache, stale generation rejection, and all failure fallbacks in `frontend/src/features/room/atmosphere/adaptivePalette.test.ts`
- [X] T051 [P] [US5] Add lifecycle tests proving media start/change/end updates or clears derived treatment without changing `useMusicStore` authority in `frontend/src/features/room/RoomAtmosphere.test.tsx`
- [X] T052 [P] [US5] Add player/track identity regression tests proving atmosphere transitions do not remount YouTube Stage or participant tracks in `frontend/src/features/room/RoomSession.test.tsx`

### Implementation for User Story 5

- [X] T053 [US5] Implement cancellable per-video adaptive palette derivation from only the existing approved YouTube thumbnail origin with bounded sample work and no server upload in `frontend/src/features/room/atmosphere/adaptivePalette.ts`
- [X] T054 [US5] Add a bounded in-memory palette cache and generation-controlled disposal so stale async results cannot replace current media in `frontend/src/features/room/atmosphere/adaptivePalette.ts`
- [X] T055 [US5] Connect current authoritative media identity and adaptive preference to ephemeral treatment while clearing it on end/failure/room teardown in `frontend/src/features/room/RoomAtmosphere.tsx`
- [X] T056 [US5] Add smooth non-flashing Mingly-owned surface transitions without altering YouTube volume, commands, player key, or media state in `frontend/src/app/globals.css`
- [X] T057 [US5] Add Playwright media start/change/end and blocked-thumbnail fallback coverage with player identity assertions in `frontend/e2e/spec005_room_atmosphere.spec.ts`

**Checkpoint**: Media-aware presentation is optional, bounded, provider-safe, and failure-isolated.

---

## Phase 8: User Story 6 - Preserve Stage Clarity and Device Capacity (Priority: P3)

**Goal**: Atmosphere yields to screen share, camera/effects, voice-only identity, drawers, accessibility, mobile layout, and constrained devices.

**Independent Test**: Exercise every Stage mode, drawers, reduced motion, responsive widths, and forced degradation; verify readability, stable media, correct layout, and static fallback.

### Tests for User Story 6

- [X] T058 [P] [US6] Add component tests for screen-share suppression, camera/effect isolation, solo/voice avatar sizing, drawer neutrality, and reaction presentation-only behavior in `frontend/src/features/room/RoomAtmosphere.test.tsx`
- [X] T059 [P] [US6] Add reduced-motion, forced-fallback, cleanup, and no-continuous-animation tests in `frontend/src/features/room/atmosphere/degradation.test.ts`
- [X] T060 [P] [US6] Extend responsive E2E coverage at 1440, 1280, 1024, 768, 430, and 375 widths for safe areas, no horizontal overflow, and no Call Dock/participant overlap in `frontend/e2e/responsive.spec.ts`

### Implementation for User Story 6

- [X] T061 [US6] Make screen-share mode suppress decorative prominence without modifying shared pixels or Stage hierarchy in `frontend/src/features/room/RoomAtmosphere.tsx`
- [X] T062 [US6] Preserve camera, SPEC 004 effects, voice-only, solo avatar, participant identity, active-speaker, and reaction semantics while varying only surrounding presentation in `frontend/src/features/room/RoomView.tsx`
- [X] T063 [US6] Keep Chat, People, Queue, participant strip, BottomControlArea, and Call Dock on stable readable surfaces above atmosphere in `frontend/src/features/room/RoomView.tsx`
- [X] T064 [US6] Implement reduced-motion and static weak-device/failure fallback that removes motion, adaptive treatment, and costly blur before communication quality in `frontend/src/features/room/atmosphere/degradation.ts`
- [X] T065 [US6] Add responsive and accessibility-safe atmosphere rules with no strobe or rapid luminance transitions in `frontend/src/app/globals.css`
- [X] T066 [US6] Add user-facing non-blocking fallback and authorization/conflict copy without exposing invalid styling input in `frontend/src/lib/i18n/uiText.ts`

**Checkpoint**: Atmosphere remains an enhancement across every established Stage and accessibility mode.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Complete security, observability, documentation, regression, and release evidence across all stories.

- [X] T067 [P] Document Room Appearance source-of-truth, versioning, Redis role, snapshot recovery, and failure isolation in `docs/room-state.md`, `docs/realtime-protocol.md`, and `docs/redis.md`
- [X] T068 [P] Document adaptive-media provider/privacy boundaries, accessibility, reduced motion, and degradation priority in `docs/media-sync.md`, `docs/security.md`, and `docs/testing-strategy.md`
- [X] T069 Audit all SPEC 005 payloads/logs to ensure no arbitrary CSS/URL, artwork blob, media frame, personal theme, or private content crosses server/Redis boundaries in `backend/internal/realtime/hub.go`, `backend/internal/realtime/redis.go`, and `frontend/src/features/room/atmosphere/adaptivePalette.ts`
- [X] T070 Run backend gates `go vet ./...`, `go test ./...`, `go test -race ./...`, and `go build ./...` from `backend/` and record exact results in `specs/005-room-atmosphere/verification.md`
- [X] T071 Run frontend gates `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` from `frontend/` and record exact results in `specs/005-room-atmosphere/verification.md`
- [X] T072 Run `pnpm test:e2e` and the automated scenarios from `specs/005-room-atmosphere/quickstart.md`, recording exact browser/viewport results in `specs/005-room-atmosphere/verification.md`
- [ ] T073 Execute two-peer Chrome checks for mode/accent convergence, host transfer, reconnect, YouTube continuity, screen share, SPEC 004 coexistence, reduced motion, and network privacy from `specs/005-room-atmosphere/quickstart.md`; record evidence in `specs/005-room-atmosphere/verification.md`
- [ ] T074 Execute physical/mobile and constrained-device checks for contrast, 375/430 safe areas, camera/effects coexistence, weak-device degradation, no strobe, and cleanup; mark every unexecuted case `NOT VERIFIED` in `specs/005-room-atmosphere/verification.md`
- [X] T075 Re-run repository search and diff review to confirm no duplicate theme/store/permission/realtime system or unrelated behavior change was introduced; record the audit in `specs/005-room-atmosphere/verification.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependency.
- **Foundational (Phase 2)**: Depends on Setup and blocks every user story.
- **US1 (Phase 3)**: Depends on Foundational; establishes shared authoritative atmosphere and is the MVP.
- **US2 (Phase 4)**: Depends on the US1 room projection/rendering seam; personal theme tests can begin after Foundational.
- **US3 (Phase 5)**: Depends on US1 mutation/rendering; backend allowlist tests can begin after Foundational.
- **US4 (Phase 6)**: Depends on US1 durable mutation/event; persistence and ordering tests can begin after Foundational.
- **US5 (Phase 7)**: Depends on US1 rendering and existing media state; palette unit work can begin after Foundational.
- **US6 (Phase 8)**: Depends on US1 rendering and should integrate after US2/US5 presentation behavior is stable.
- **Polish (Phase 9)**: Depends on all stories selected for release; T073–T074 remain open until real-browser/device evidence exists.

### User Story Dependency Graph

```text
Setup → Foundation → US1 (shared modes / MVP)
                         ├── US2 (theme independence)
                         ├── US3 (accent)
                         ├── US4 (recovery/convergence)
                         └── US5 (adaptive media)
                              └── US6 (Stage/accessibility/degradation integration)
All selected stories → Polish and release gates
```

### Parallel Opportunities

- T002–T004 can run in parallel.
- T005, T008, T011, and T013 can begin in parallel before their integration dependencies.
- Within each story, all tasks marked `[P]` are test-first work on separate files.
- After US1, US2/US3/US4/US5 can be assigned in parallel, with shared-file integration serialized.
- T067 and T068 can run in parallel; automated backend/frontend gates can run concurrently once code is stable.

## Parallel Execution Examples

### User Story 1

```text
T016 domain authority/validation tests
T017 realtime command/event tests
T018 Redis two-hub tests
T019 frontend version reducer tests
T020 room-settings interaction tests
```

### User Stories 2–5 after US1

```text
US2: T030–T031 personal-theme composition tests
US3: T036–T037 accent security/presentation tests
US4: T042–T045 persistence/recovery/concurrency tests
US5: T050–T052 adaptive palette/lifecycle/identity tests
```

### User Story 6

```text
T058 Stage mode/component isolation tests
T059 degradation lifecycle tests
T060 responsive E2E matrix
```

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational.
2. Complete US1 through T029.
3. Run US1 domain, realtime, reducer, UI, and Playwright checks.
4. Stop and validate that all four shared modes converge without changing communication state.

### Incremental Delivery

1. Deliver shared authoritative modes.
2. Lock theme independence.
3. Add safe room accents.
4. Prove persistent/reconnect/multi-instance convergence.
5. Add optional adaptive media with fallback.
6. Complete Stage/accessibility/degradation integration.
7. Run full automated and physical release gates.

## Notes

- `[P]` means separate-file or independent test work; tasks that edit shared files remain serialized.
- Tests precede implementation and must fail for the intended missing behavior.
- Existing `loft.theme`, technical module names, routes, and protocols remain unless a task explicitly requires a compatible extension.
- Never claim PASS for T073 or T074 without executing and recording the required real-browser/device evidence.
