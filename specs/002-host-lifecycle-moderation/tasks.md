# Tasks: Host Lifecycle & Moderation

**Input**: Design documents from `/specs/002-host-lifecycle-moderation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/moderation.md, quickstart.md

**Tests**: Included because the feature specification requires race, authorization, reconnect, and multi-instance verification.

## Phase 1: Setup

**Purpose**: Confirm existing authority, protocol, lifecycle, and test seams before changing behavior.

- [X] T001 Audit existing host, owner, kick, lock, reconnect, Redis, LiveKit, and snapshot behavior in `backend/internal/realtime/hub.go`, `backend/internal/domain/domain.go`, `backend/internal/httpapi/server.go`, and `frontend/src/features/room/RoomView.tsx`.
- [X] T002 [P] Map current moderation commands/events and connection-generation semantics into `specs/002-host-lifecycle-moderation/contracts/moderation.md` and `backend/internal/realtime/*_test.go`.
- [X] T003 [P] Record current host eligibility, guest identity limits, reconnect grace, and multi-tab behavior in `specs/002-host-lifecycle-moderation/research.md`.

## Phase 2: Foundational

**Purpose**: Establish shared authority/versioning rules before story work.

- [X] T004 Define one server-authoritative host/owner decision boundary and stale-session identity rules in `backend/internal/domain/domain.go` and `backend/internal/realtime/hub.go`.
- [X] T005 [P] Add typed host/moderation state fields and snapshot/event contracts without using `map[string]interface{}` or `any` blobs in `backend/internal/realtime/hub.go`, `frontend/src/types/api.ts`, and `frontend/src/lib/realtime.ts`.
- [X] T006 [P] Add domain predicates and validation for eligible host transfer, self-kick, invalid target, stale target, and non-host actions in `backend/internal/domain/domain.go` and `backend/internal/domain/domain_test.go`.
- [X] T007 Define monotonic room/authority version handling and no-I/O-under-lock boundaries for moderation actions in `backend/internal/realtime/hub.go` and `specs/002-host-lifecycle-moderation/data-model.md`.
- [X] T008 [P] Add structured moderation outcome/error codes and secret-free observability fields in `backend/internal/httpapi/server.go`, `backend/internal/realtime/hub.go`, and `frontend/src/lib/i18n/uiText.ts`.

**Checkpoint**: Foundation preserves current kick/lock/reconnect behavior and establishes the single authority boundary.

## Phase 3: User Story 1 - Reliable Host Authority (Priority: P1) 🎯 MVP

**Goal**: Transfer, preserve, and fail over realtime host authority deterministically while retaining durable ownership.

**Independent Test**: Transfer host, exercise reconnect grace, expire host grace, and verify one successor across instances and fresh snapshots.

### Tests for User Story 1

- [X] T009 [P] [US1] Add domain tests for owner/current-host distinction, eligible transfer, stale actor denial, and guest eligibility in `backend/internal/domain/domain_test.go`.
- [X] T010 [P] [US1] Add realtime tests for transfer vs disconnect, reconnect-before-grace, grace expiry, stale close, multiple tabs, and old-host return in `backend/internal/realtime/hub_test.go`.
- [X] T011 [US1] Add cross-instance transfer/failover convergence tests in `backend/internal/realtime/redis_test.go`, `backend/internal/realtime/hub_test.go`, and `backend/internal/httpapi/server_test.go`.

### Implementation for User Story 1

- [X] T012 [US1] Implement authoritative host transfer with compare/version validation and immediate old-host revocation in `backend/internal/realtime/hub.go` and `backend/internal/domain/domain.go`.
- [X] T013 [US1] Extend reconnect grace and deterministic successor selection without leaking timers or creating duplicate host events in `backend/internal/realtime/hub.go`.
- [X] T014 [US1] Persist or coordinate only the minimum required host/failover state using existing store/Redis boundaries in `backend/internal/store/postgres.go` and `backend/internal/realtime/redis.go`.
- [X] T015 [US1] Emit typed host-change facts and expose current host in authoritative snapshots in `backend/internal/realtime/hub.go`, `frontend/src/types/api.ts`, and `frontend/src/lib/realtime.ts`.
- [X] T016 [US1] Add lightweight host-transfer controls and neutral host-change feedback in `frontend/src/features/room/RoomView.tsx` and `frontend/src/lib/i18n/uiText.ts`.

**Checkpoint**: US1 independently supports transfer, temporary disconnect recovery, failover, old-host return, and snapshot recovery.

## Phase 4: User Story 2 - Safe Participant Moderation (Priority: P1)

**Goal**: Harden kick and add limited temporary room bans without weakening identity or reconnect security.

**Independent Test**: Host kicks a participant, stale reconnect races, duplicate kick retries, and cross-instance removal all converge safely.

### Tests for User Story 2

- [X] T017 [P] [US2] Add authorization tests for non-host, self, missing, stale, host-target, and duplicate kick actions in `backend/internal/domain/domain_test.go` and `backend/internal/httpapi/server_test.go`.
- [X] T018 [P] [US2] Add kick/reconnect race and stale cleanup tests in `backend/internal/realtime/hub_test.go` and `backend/internal/realtime/leave_disconnect_test.go`.
- [ ] T019 [P] [US2] Add temporary-ban expiry, guest identity limitation, Redis fallback, and multi-instance tests in `backend/internal/realtime/distributed_limits_test.go`, `backend/internal/realtime/redis_admission_test.go`, and `backend/internal/httpapi/server_test.go`.

### Implementation for User Story 2

- [X] T020 [US2] Extend existing kick state and authorization so authoritative removal invalidates stale reconnect without creating a second moderation architecture in `backend/internal/realtime/hub.go` and `backend/internal/domain/domain.go`.
- [X] T021 [US2] Implement room-scoped temporary ban lifecycle, expiry, and safe admission checks using existing PostgreSQL/Redis boundaries in `backend/internal/store/postgres.go`, `backend/internal/realtime/redis_admission.go`, and `backend/migrations/` only if durable fields are required.
- [X] T022 [US2] Ensure remote participant removal closes application and LiveKit participation safely after the authoritative decision in `backend/internal/realtime/hub.go`, `backend/internal/realtime/redis.go`, and `backend/internal/livekit/token.go`.
- [X] T023 [US2] Preserve typed `participant.kicked`/leave semantics and map neutral removal/ban errors in `frontend/src/lib/realtime.ts`, `frontend/src/features/room/RoomSession.tsx`, and `frontend/src/lib/i18n/uiText.ts`.
- [X] T024 [US2] Add responsive participant moderation menu/sheet with confirmation, focus management, and no host-only controls for guests/non-hosts in `frontend/src/features/room/RoomView.tsx`, `frontend/src/components/room/KickParticipantDialog.tsx`, and `frontend/src/components/room/ParticipantMenu.tsx`.

**Checkpoint**: US2 independently supports secure kick, honest temporary ban semantics, stale reconnect rejection, and cross-instance cleanup.

## Phase 5: User Story 3 - Lock and Reconnect Consistency (Priority: P1)

**Goal**: Integrate lock, moderation, reconnect, snapshots, and media cleanup without bypasses.

**Independent Test**: Lock admission, kick during reconnect, miss an event, resync, and remove a screen-sharing participant.

- [X] T025 [P] [US3] Add lock-vs-join, kick-vs-reconnect, snapshot recovery, and media cleanup race tests in `backend/internal/realtime/hub_test.go`, `backend/internal/httpapi/server_test.go`, and `frontend/src/lib/realtime.test.ts`.
- [X] T026 [US3] Extend canonical room snapshots and reconnect reconciliation for current host, moderation state, lock, and participant generation in `backend/internal/realtime/hub.go`, `frontend/src/types/api.ts`, and `frontend/src/lib/realtime.ts`.
- [X] T027 [US3] Ensure stale room/session authorization cannot bypass SPEC 001 password/lock decisions in `backend/internal/httpapi/server.go`, `backend/internal/realtime/hub.go`, and `backend/internal/auth/room_password.go`.
- [X] T028 [US3] Reconcile removed participants with LiveKit and Stage state without sending media through the application WebSocket in `frontend/src/features/room/RoomSession.tsx`, `frontend/src/features/room/RoomView.tsx`, and `backend/internal/livekit/`.

**Checkpoint**: US3 preserves admission, reconnect, and media invariants under moderation races.

## Phase 6: User Story 4 - Lightweight Host Controls (Priority: P2)

**Goal**: Make host lifecycle controls understandable and usable on desktop, tablet, and mobile.

**Independent Test**: Use keyboard, touch, and screen-reader navigation to perform a confirmed moderation action.

- [ ] T029 [P] [US4] Add accessibility and responsive tests for participant menus, confirmation dialogs, focus return, and destructive labels in `frontend/src/features/room/RoomView.test.tsx`, `frontend/src/components/room/KickParticipantDialog.test.tsx`, and `frontend/src/components/room/ParticipantMenu.test.tsx`.
- [X] T030 [US4] Implement host transfer and temporary-ban menu states using existing Astryx/theme tokens and Stage-first layout in `frontend/src/features/room/RoomView.tsx`, `frontend/src/components/room/ParticipantMenu.tsx`, and `frontend/src/app/globals.css`.
- [X] T031 [US4] Add localized neutral copy for host transfer, failover, kick, ban, stale action, and reconnect outcomes in `frontend/src/lib/i18n/dictionaries/en.ts`, `frontend/src/lib/i18n/dictionaries/vi.ts`, and `frontend/src/lib/i18n/uiText.ts`.

**Checkpoint**: US4 provides a small, accessible moderation surface without a dashboard redesign.

## Phase 7: Polish & Cross-Cutting Validation

- [X] T032 [P] Update protocol, security, room-state, and README documentation for owner/host semantics, moderation, failover, temporary bans, and guest limitations in `docs/realtime-protocol.md`, `docs/security.md`, `docs/room-state.md`, and `README.md`.
- [X] T033 [P] Update feature data model, contract, and quickstart evidence requirements in `specs/002-host-lifecycle-moderation/data-model.md`, `specs/002-host-lifecycle-moderation/contracts/moderation.md`, and `specs/002-host-lifecycle-moderation/quickstart.md`.
- [X] T034 Run backend `go test ./...`, `go test -race ./...`, `go vet ./...`, and `go build ./...` from `backend/` and record results in `specs/002-host-lifecycle-moderation/quickstart.md`.
- [X] T035 Run frontend TypeScript, Vitest, lint, and production build checks from `frontend/` and record results in `specs/002-host-lifecycle-moderation/quickstart.md`.
- [ ] T036 Run multi-instance, Redis outage, reconnect, LiveKit cleanup, multi-tab, and backward-compatibility acceptance matrix and record verified/NOT VERIFIED evidence in `specs/002-host-lifecycle-moderation/quickstart.md`.

## Dependencies & Execution Order

### Phase Dependencies

- Setup → Foundational → US1/US2/US3 P1 stories → US4 P2 polish → cross-cutting validation.
- Foundational tasks T004–T008 block all user stories.
- US2 depends on the host authority boundary from US1 for authoritative actor validation.
- US3 depends on US1 host state and US2 moderation invalidation.
- US4 depends on the final contracts from US1–US3.

### Parallel Opportunities

- T002, T003, T005, T006, and T008 can run in parallel after T001.
- T009 and T010 can run in parallel; T011 follows the authority contract.
- T017–T019 can run in parallel before US2 implementation.
- T025 can begin after the US1/US2 event contracts are stable.
- T029 and T031 can run in parallel with T030.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases.
2. Complete US1 host authority transfer, reconnect grace, and deterministic failover.
3. Validate US1 independently with race and multi-instance tests.

### Incremental Delivery

1. Add US2 secure kick/temporary-ban lifecycle.
2. Add US3 lock/reconnect/snapshot/media consistency.
3. Add US4 responsive moderation controls and documentation.
4. Run the complete quickstart matrix before release.

## Notes

- Every task includes a concrete repository path and follows the required checklist format.
- Implementation must preserve existing source-of-truth ownership and avoid a duplicate moderation system.
