# Tasks: Persistent Rooms & Room Access

**Input**: Design documents from `/specs/001-persistent-rooms-room-access/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/room-access.md, quickstart.md

## Phase 1: Setup

- [X] T001 Confirm current room schema, API routes, typed room payloads, and existing regression tests in `backend/migrations`, `backend/internal`, and `frontend/src`
- [ ] T002 [P] Add MVP3 room-access error-code translations for English and Vietnamese in `frontend/src/lib/i18n/dictionaries/en.ts`, `frontend/src/lib/i18n/dictionaries/vi.ts`, and `frontend/src/lib/i18n/uiText.ts`

## Phase 2: Foundational

- [X] T003 Add sequential room-access migration with nullable one-way password verifier, policy compatibility defaults, and safe indexes in `backend/migrations/000004_room_access.up.sql` and `backend/migrations/000004_room_access.down.sql`
- [X] T004 [P] Extend domain room/access types, validation errors, and centralized authorization predicates in `backend/internal/domain/domain.go`
- [X] T005 [P] Define safe access-policy and settings DTO types in `backend/internal/domain/domain.go` and `frontend/src/types/api.ts`
- [X] T006 [P] Add one-way room-password hashing/verification abstraction with bounded input validation in `backend/internal/auth/room_password.go`
- [X] T007 Extend the store and governance interfaces for room policy reads, versioned settings updates, password verifier persistence, and safe owner listing in `backend/internal/domain/domain.go`

## Phase 3: User Story 1 — Create and Revisit a Persistent Room (P1) 🎯 MVP

**Goal**: Preserve durable room creation and owner re-entry while exposing the new safe access policy fields.

**Independent Test**: Authenticated owner creates a named room, all participants leave, and the owner later lists and re-enters the same room without recreation.

- [X] T008 [US1] Update transactional room creation and room reads to populate access-policy defaults and preserve short-code/legacy invite compatibility in `backend/internal/store/postgres.go`
- [ ] T009 [US1] Add HTTP/API regression coverage for authenticated creation, owner listing, room resolution, and persistence after active-room eviction in `backend/internal/httpapi/server_test.go` and `backend/internal/store/release_integration_test.go`
- [ ] T010 [P] [US1] Extend frontend room API/types and owner-room list rendering to show safe password-required/lock indicators without exposing secrets in `frontend/src/lib/api.ts`, `frontend/src/types/api.ts`, and `frontend/src/app/home/page.tsx`
- [ ] T011 [US1] Verify owner re-entry and existing delete confirmation remain compatible with durable room lifecycle in `frontend/src/app/home/page.tsx` and `frontend/src/components/room/DeleteRoomDialog.tsx`

## Phase 4: User Story 2 — Join Without an Account (P1)

**Goal**: Keep public guest joining account-free while using one admission policy for invite and public-ID paths.

**Independent Test**: Logged-out guest opens a valid invite/public identifier and joins a public room without account creation.

- [ ] T012 [P] [US2] Add domain tests for public guest admission, disabled guest access, locked rooms, room scope, and legacy identifier compatibility in `backend/internal/domain/domain_test.go`
- [X] T013 [US2] Extend preview and guest-session handlers to return safe policy state and preserve friendly not-found/locked/guest-denied behavior in `backend/internal/httpapi/server.go`
- [X] T014 [US2] Add HTTP contract tests proving guest admission remains unauthenticated and all public entry paths resolve the same room policy in `backend/internal/httpapi/server_test.go`
- [ ] T015 [P] [US2] Update join-page preview, display-name flow, accessibility labels, and error rendering for public/locked/unavailable states in `frontend/src/app/join/[roomId]/page.tsx`
- [ ] T016 [US2] Add frontend API/join regression tests for guest admission and translated access errors in `frontend/src/lib/api.test.ts` and `frontend/src/app/join/[roomId]/page.test.tsx`

## Phase 5: User Story 3 — Protect a Room with a Password (P1)

**Goal**: Protect rooms with a server-verified password, distributed bounded failure protection, and reusable secret-free invites.

**Independent Test**: Missing/wrong password is denied, repeated failures cool down, and the correct password yields a normal guest session.

- [X] T017 [P] [US3] Add password verifier unit tests covering valid passwords, wrong passwords, empty/oversized input, and no plaintext persistence in `backend/internal/auth/room_password_test.go`
- [ ] T018 [P] [US3] Add distributed failed-password limiter behavior and fallback tests in `backend/internal/ratelimit/limiter_test.go` and `backend/internal/realtime/distributed_limits_test.go`
- [X] T019 [US3] Implement password verification before guest credential issuance and safe error mapping in `backend/internal/httpapi/server.go`
- [X] T020 [US3] Add room-password admission and bypass-resistance tests, including alternate entry paths and no-secret log assertions, in `backend/internal/httpapi/server_test.go`
- [X] T021 [US3] Extend guest join API/types and join UI with accessible password input, retry/cooldown states, mobile-safe layout, and secret-free invite behavior in `frontend/src/lib/api.ts`, `frontend/src/types/api.ts`, and `frontend/src/app/join/[roomId]/page.tsx`
- [ ] T022 [US3] Add frontend tests for password-required, wrong-password, rate-limited, and successful guest flows in `frontend/src/app/join/[roomId]/page.test.tsx` and `frontend/src/lib/api.test.ts`

## Phase 6: User Story 4 — Manage Access and Lock State (P1)

**Goal**: Let the owner update name/access/password/lock with authorization and optimistic versioning while keeping connected participants.

**Independent Test**: Owner changes policy, existing participants remain connected, new joins observe current policy, and stale/non-owner mutations fail.

- [ ] T023 [P] [US4] Add versioned room-settings store operations with transactional compare-and-swap and verifier replacement/clearing in `backend/internal/store/postgres.go`
- [ ] T024 [US4] Add centralized owner settings evaluator and policy-transition tests in `backend/internal/domain/domain.go` and `backend/internal/domain/domain_test.go`
- [ ] T025 [US4] Add owner settings HTTP routes, safe response DTOs, structured errors, and observability fields in `backend/internal/httpapi/server.go` and `backend/internal/httpapi/server_test.go`
- [ ] T026 [US4] Propagate persisted access-policy changes to active room authority and typed snapshots/events without database or network I/O under realtime locks in `backend/internal/realtime/hub.go`, `backend/internal/realtime/redis.go`, and `backend/internal/realtime/hub_test.go`
- [ ] T027 [P] [US4] Add owner room-settings UI for name/access/password/lock with confirmation, expected-version handling, focus management, and light/dark/system tokens in `frontend/src/features/room/RoomSettings.tsx`, `frontend/src/features/room/RoomView.tsx`, and `frontend/src/lib/api.ts`
- [ ] T028 [US4] Extend TypeScript discriminated unions and reconnect snapshot handling for safe access-policy updates in `frontend/src/types/api.ts`, `frontend/src/lib/realtime.ts`, and `frontend/src/features/room/RoomSession.tsx`
- [ ] T029 [US4] Add settings, lock, stale-version, and connected-participant regression tests in `frontend/src/features/room/RoomSettings.test.tsx` and `frontend/src/lib/realtime.test.ts`

## Phase 7: User Story 5 — Return Through Lightweight Room Lists (P2)

**Goal**: Make owned persistent rooms easy to identify, rejoin, and manage without a dashboard redesign.

**Independent Test**: Authenticated owner sees owned rooms in the Lobby, enters one, and opens only in-scope settings.

- [ ] T030 [P] [US5] Add owner-room list API contract assertions and safe sorting/pagination regression coverage in `backend/internal/httpapi/server_test.go` and `backend/internal/store/postgres.go`
- [ ] T031 [US5] Add lightweight owned-room cards/actions and settings entry points in `frontend/src/app/home/page.tsx`, `frontend/src/app/home/page.test.tsx`, and existing lobby components

## Phase 8: User Story 6 — Leave, Archive, or Delete Deliberately (P2)

**Goal**: Preserve explicit permanent deletion and clearly separate participant departure from room lifecycle deletion.

**Independent Test**: Leaving does not delete; confirmed owner deletion makes future entry unavailable; canceled deletion changes nothing.

- [ ] T032 [P] [US6] Add lifecycle regression tests for leave, active/deleting guard, confirmed delete, canceled delete, and no silent recreation in `backend/internal/httpapi/server_test.go`, `backend/internal/realtime/leave_disconnect_test.go`, and `backend/internal/store/release_integration_test.go`
- [ ] T033 [US6] Update lifecycle copy and accessibility behavior to distinguish leave from permanent delete in `frontend/src/components/room/DeleteRoomDialog.tsx`, `frontend/src/features/room/RoomView.tsx`, and i18n dictionaries

## Phase 9: User Story 7 — Recover Safely Across Disconnects and Instances (P2)

**Goal**: Reconnect and cross-instance admission always use current authoritative access policy.

**Independent Test**: A legitimately admitted guest reconnects successfully while valid; policy invalidation or cross-instance changes deny stale access safely.

- [ ] T034 [P] [US7] Add reconnect policy-change tests for valid session, changed password, newly locked room, deleted room, and fresh snapshot semantics in `backend/internal/realtime/hub_test.go` and `frontend/src/lib/realtime.test.ts`
- [ ] T035 [US7] Add cross-instance policy propagation/rate-limit tests with Redis fallback behavior in `backend/internal/realtime/redis_test.go`, `backend/internal/realtime/redis_admission_test.go`, and `backend/internal/httpapi/server_test.go`
- [ ] T036 [US7] Add LiveKit-token and message-admission regression checks after access changes in `backend/internal/httpapi/server_test.go`

## Phase 10: Polish & Cross-Cutting Validation

- [ ] T037 [P] Update API/protocol/security documentation for room password policy, safe fields, lifecycle, and failure behavior in `docs/realtime-protocol.md`, `docs/security.md`, `docs/room-state.md`, and `README.md`
- [ ] T038 [P] Add accessibility and responsive browser checks for preview, password, lock, settings, and delete flows in `specs/001-persistent-rooms-room-access/quickstart.md` and frontend tests
- [ ] T039 Run backend race/vet/build and frontend test/lint/typecheck/build commands from `specs/001-persistent-rooms-room-access/quickstart.md`
- [ ] T040 Run multi-instance, Redis outage, reconnect, media, and backward-compatibility acceptance matrix and record evidence in `specs/001-persistent-rooms-room-access/quickstart.md`

## Phase 11: Password Setup UX Completion

- [ ] T041 [US3] Add initial password-enabled/password fields to the authenticated create-room flow and pass the policy to the existing create-room endpoint in `frontend/src/app/home/page.tsx` and `frontend/src/lib/api.ts`.
- [ ] T042 [US3] Hash and persist the initial room password during creation with the same validation and secret-free response rules as later settings updates in `backend/internal/httpapi/server.go`, `backend/internal/domain/domain.go`, and `backend/internal/store/postgres.go`.
- [ ] T043 [US4] Expose the existing owner Room Settings entry point from the active-room host controls without exposing it to guests or non-owners in `frontend/src/features/room/RoomView.tsx`.
- [ ] T044 [P] Update create-room, active-room settings, and password transition documentation and regression coverage in `README.md`, `docs/room-state.md`, and the feature quickstart.

## Dependencies & Execution Order

- Setup → Foundational → US1/US2/US3/US4 P1 stories → US5/US6/US7 P2 stories → Polish.
- T003–T007 block all story work.
- US3 depends on foundational policy types and may reuse US2 admission behavior.
- US4 depends on the durable fields and safe DTOs from foundational work and is the integration point for later stories.
- US5/US6/US7 can proceed in parallel after the P1 access policy core is complete, with same-file tasks serialized.

## Parallel Opportunities

- T002, T004, T005, and T006 can run in parallel.
- Within US3, verifier tests and limiter tests can run in parallel before handler work.
- Within US4, store work and frontend settings scaffolding can proceed in parallel after contracts are fixed.
- US5, US6, and US7 can be staffed independently after US4 policy synchronization is complete.

## Implementation Strategy

1. Deliver the MVP slice: durable policy fields, public guest compatibility, password-protected guest admission, owner settings, and safe lock/reconnect behavior.
2. Validate US1–US4 with race tests and browser acceptance before adding secondary Lobby/lifecycle polish.
3. Add owned-room UX, explicit lifecycle regression coverage, and multi-instance failure validation.
4. Run the full quickstart matrix and mark every task complete only after verification.
