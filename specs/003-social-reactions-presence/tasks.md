# Tasks: Social Reactions & Presence

**Input**: Design documents from `/specs/003-social-reactions-presence/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/social-realtime.md, quickstart.md

**Tests**: Required by the specification and quickstart acceptance gates. Write focused tests before implementation and verify they fail for the intended reason.

**Organization**: Tasks are grouped by user story and ordered P1 before P2. Story labels preserve numbering from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable because it touches independent files and has no dependency on an unfinished task.
- **[Story]**: User story from spec.md.
- Every task names concrete repository paths.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm current behavior and prepare bounded assets/test surfaces without changing product behavior.

- [X] T001 Audit and record existing reaction, participant, reconnect, Redis fanout/rate-limit, LiveKit state, Stage, and cleanup behavior in `specs/003-social-reactions-presence/research.md`, `backend/internal/realtime/hub.go`, and `frontend/src/features/room/RoomView.tsx`.
- [X] T002 [P] Inventory the 15 root `*.wav` candidates for ownership, duration, peak/silence, format, and intended UI/room category in `specs/003-social-reactions-presence/sfx-assets.md`; do not integrate unapproved files.
- [X] T003 [P] Add SPEC 003 test scenario fixtures/helpers without changing runtime behavior in `backend/internal/realtime/hub_test.go` and `frontend/src/lib/realtime.test.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared typed social state and lifecycle rules used by all stories.

**⚠️ CRITICAL**: No story implementation begins until this phase is complete.

- [X] T004 Add closed social domain types and validation where ReactionKind is exactly `❤️|😂|🔥|👏|😭`, Wave accepts no actor/target payload, and Raise Hand is self-only in `backend/internal/domain/domain.go` and `backend/internal/domain/domain_test.go`.
- [X] T005 [P] Extend typed frontend contracts with optional `raised_hand: boolean` defaulting false and `social_version: number` defaulting zero, plus Wave/hand events, in `frontend/src/types/api.ts` and `frontend/src/lib/realtime.ts`.
- [X] T006 Define participant social-state version/generation comparison, idempotency, and cleanup transitions in `backend/internal/realtime/hub.go` with no database, Redis, LiveKit, HTTP, or socket I/O under room locks.
- [X] T007 [P] Add safe rolling-deployment parsing tests for absent social fields and unknown Wave/hand events in `frontend/src/lib/realtime.test.ts` and `frontend/src/lib/state.test.ts`.
- [X] T008 Extend the existing Redis presence participant representation to carry current `raised_hand` and `social_version`, preserving old leases and exact-connection cleanup in `backend/internal/realtime/redis_admission.go`.
- [ ] T009 Add structured, secret-free social error/metric boundaries for invalid, stale, limited, dropped, and propagation-failed actions in `backend/internal/realtime/hub.go` and `backend/internal/httpapi/server.go`.

**Checkpoint**: One typed participant/social authority is ready; no second store, bus, snapshot, or database schema exists.

---

## Phase 3: User Story 1 - React Without Interrupting (Priority: P1) 🎯 MVP

**Goal**: Deliver the final five bounded, ephemeral, silent reactions through the existing realtime path.

**Independent Test**: Two participants send all five reactions and a burst; attribution is correct, visible groups stay at most 6, expiry is under 5 seconds, Stage does not shift, and chat history is unchanged.

### Tests for User Story 1

- [X] T010 [P] [US1] Add backend contract tests for the exact `❤️|😂|🔥|👏|😭` set, retired 👍/🎉 rejection, malformed payloads, identity spoof resistance, and no persistence in `backend/internal/realtime/hub_test.go`.
- [ ] T011 [P] [US1] Add participant/room burst, distributed-limit, Redis failure fallback, and slow-consumer tests for reactions in `backend/internal/realtime/media_test.go`, `backend/internal/realtime/distributed_limits_test.go`, and `backend/internal/realtime/redis_test.go`.
- [X] T012 [P] [US1] Add frontend aggregation tests enforcing at most 6 visible groups, count cap 99, expiry within 5 seconds, duplicate grouping, and reset cleanup in `frontend/src/stores/useReactionStore.test.ts`.

### Implementation for User Story 1

- [X] T013 [US1] Normalize existing `reaction.send` validation and `reaction.sent` facts to the final five glyph values while deriving actor identity from the admitted connection in `backend/internal/realtime/hub.go`.
- [X] T014 [US1] Preserve existing distributed reaction limiting, room burst guard, non-blocking ephemeral fanout, and Redis origin-loop protection in `backend/internal/realtime/distributed_limits.go`, `backend/internal/realtime/redis.go`, and `backend/internal/realtime/hub.go`.
- [X] T015 [US1] Update reaction controls, localized accessible names, bounded Stage grouping, expiry scheduler, and reaction/chat silence in `frontend/src/features/room/RoomView.tsx`, `frontend/src/stores/useReactionStore.ts`, and `frontend/src/lib/i18n/uiText.ts`.
- [X] T016 [US1] Verify reaction events never enter `frontend/src/stores/useChatStore.ts` or durable message writes in `backend/internal/store/postgres.go`, and document the preserved boundary in `docs/realtime-protocol.md`.

**Checkpoint**: US1 is independently usable as the reaction-only MVP.

---

## Phase 4: User Story 2 - Raise and Lower a Hand (Priority: P1)

**Goal**: Make Raise Hand authoritative current participant state that survives valid reconnect and clears on true removal.

**Independent Test**: Raise, reconnect within grace, reject an old socket mutation, lower, then leave/kick/ban; snapshots converge and no ghost hand remains.

### Tests for User Story 2

- [ ] T017 [P] [US2] Add domain/realtime tests for self-only mutation, idempotent set, expected-version conflict, stale generation, and unsupported target mutation in `backend/internal/domain/domain_test.go` and `backend/internal/realtime/hub_test.go`.
- [ ] T018 [P] [US2] Add reconnect-within-grace, grace-expiry, same-tab replacement, stale-close, multi-tab, leave, kick, ban, host-transfer, and room-empty cleanup tests in `backend/internal/realtime/leave_disconnect_test.go` and `backend/internal/realtime/hub_test.go`.
- [ ] T019 [P] [US2] Add cross-instance out-of-order hand-change, Redis presence hydration, Redis outage fallback, and snapshot convergence tests in `backend/internal/realtime/redis_admission_test.go` and `backend/internal/realtime/hub_test.go`.
- [X] T020 [P] [US2] Add frontend reducer/store tests for optional defaults, newer-version wins, stale facts ignored, snapshot replacement, and participant removal cleanup in `frontend/src/lib/realtime.test.ts` and `frontend/src/lib/state.test.ts`.

### Implementation for User Story 2

- [X] T021 [US2] Extend the existing participant state with `raised_hand` and monotonic `social_version`, preserving connection identity/generation, in `backend/internal/domain/domain.go` and `backend/internal/realtime/hub.go`.
- [X] T022 [US2] Implement idempotent `participant.hand.set` validation and authoritative `participant.hand_changed` publication, applying local state under lock and Redis refresh/fanout only after unlock, in `backend/internal/realtime/hub.go` and `backend/internal/realtime/redis_admission.go`.
- [X] T023 [US2] Include current hand state in `room.snapshot`, remote presence merge, reconnect replacement, and removal cleanup without replaying social history in `backend/internal/realtime/hub.go`.
- [X] T024 [US2] Reconcile typed hand snapshots/events into the existing participant store and RoomSession without a parallel hand store in `frontend/src/stores/useRoomStore.ts`, `frontend/src/lib/realtime.ts`, and `frontend/src/features/room/RoomSession.tsx`.
- [X] T025 [US2] Add self Raise/Lower Hand control and a restrained semantic indicator to the existing ParticipantTile variants without reordering/remounting media in `frontend/src/features/room/RoomView.tsx`, `frontend/src/features/room/RoomSession.tsx`, and `frontend/src/lib/i18n/uiText.ts`.

**Checkpoint**: US2 independently proves authoritative snapshot/reconnect social state.

---

## Phase 5: User Story 4 - Trustworthy Room Presence (Priority: P1)

**Goal**: Preserve correct join/leave/reconnect semantics while social state is added.

**Independent Test**: Disconnect/reconnect and replace stale sockets on one/two instances; exactly one participant remains and only true departure emits leave/cleanup.

### Tests for User Story 4

- [ ] T026 [P] [US4] Expand lifecycle regression tests for duplicate join suppression, delayed stale close, exact lease cleanup, and one true leave event in `backend/internal/realtime/leave_disconnect_test.go`.
- [ ] T027 [P] [US4] Add tests proving LiveKit remains authoritative for speaking, microphone, camera, and screen-share state and social updates do not remount tracks in `frontend/src/features/room/mediaSession.test.ts` and `frontend/src/features/room/stageLayout.test.ts`.

### Implementation for User Story 4

- [X] T028 [US4] Integrate social cleanup into existing disconnect grace, reconnect replacement, participant leave, kick, temporary ban, and room teardown paths in `backend/internal/realtime/hub.go` without duplicate lifecycle events.
- [X] T029 [US4] Preserve current Redis lease TTL/admission and same-tab replacement semantics while refreshing participant social fields in `backend/internal/realtime/redis_admission.go` and `docs/presence.md`.
- [X] T030 [US4] Keep LiveKit hooks as the only speaking/mic/camera/share presentation source and compose social indicators without copying media state into WebSocket participant state in `frontend/src/features/room/RoomSession.tsx`.

**Checkpoint**: US4 demonstrates no presence/media authority regression.

---

## Phase 6: User Story 3 - Wave to the Room (Priority: P2)

**Goal**: Add a friendly room-level Wave as a distinct bounded ephemeral fact.

**Independent Test**: Wave on one and two instances; feedback is attributed, rate-limited, expires, and never enters chat/snapshot history.

### Tests for User Story 3

- [ ] T031 [P] [US3] Add Wave contract tests for empty payload, server-derived actor, no target, rate limit, cross-instance fanout, Redis failure, and no snapshot/chat persistence in `backend/internal/realtime/hub_test.go` and `backend/internal/realtime/redis_test.go`.
- [ ] T032 [P] [US3] Add frontend Wave expiry, cleanup, and no-chat tests in `frontend/src/stores/useReactionStore.test.ts` and `frontend/src/lib/realtime.test.ts`.

### Implementation for User Story 3

- [X] T033 [US3] Implement `wave.send` / `wave.sent` using the existing social limiter and ephemeral room fanout with no client actor/target authority in `backend/internal/realtime/hub.go` and `backend/internal/realtime/distributed_limits.go`.
- [X] T034 [US3] Extend the existing transient social presentation store to hold bounded Wave feedback without creating another event/realtime store in `frontend/src/stores/useReactionStore.ts` and `frontend/src/features/room/RoomSession.tsx`.
- [X] T035 [US3] Add a localized accessible Wave action to the compact Call Dock social popover and restrained Stage feedback in `frontend/src/features/room/RoomView.tsx` and `frontend/src/lib/i18n/uiText.ts`.

**Checkpoint**: US3 is independently testable without reactions or SFX.

---

## Phase 7: User Story 5 - Calm Local Sound Feedback (Priority: P2)

**Goal**: Add optional bounded local/room SFX without affecting LiveKit, shared media, reactions, or chat.

**Independent Test**: Toggle local and room categories, volume, autoplay blocking, missing assets, and bursts; call/shared-media audio remains unchanged.

### Tests for User Story 5

- [X] T036 [P] [US5] Add SFX policy/store tests for defaults `enabled/enabled/60`, validation range 0–100, invalid storage fallback, category isolation, reaction/chat silence, and immediate updates in `frontend/src/stores/useSfxStore.test.ts`.
- [X] T037 [P] [US5] Add manager tests for fixed-manifest-only lookup, bounded voices, priority dropping, one-time unlock, blocked autoplay, missing asset, cleanup, and no rejected-promise noise in `frontend/src/lib/sfx.test.ts`.
- [X] T038 [P] [US5] Validate approved WAV derivatives and add an automated manifest/file existence check in `frontend/src/lib/sfxAssets.test.ts` and `specs/003-social-reactions-presence/sfx-assets.md`.

### Implementation for User Story 5

- [X] T039 [US5] Move only approved optimized SFX derivatives from root candidates into `frontend/public/sfx/` and record license/source, duration, loudness, and category in `specs/003-social-reactions-presence/sfx-assets.md`.
- [X] T040 [US5] Implement one fixed-manifest bounded SFX manager with no arbitrary URLs, small voice pool, harmless blocked/missing playback, user-gesture unlock, and owned cleanup in `frontend/src/lib/sfx.ts`.
- [X] T041 [US5] Implement centralized browser preferences with `sound_effects_enabled=true`, `room_sounds_enabled=true`, `volume=60`, schema validation, and one new current-brand key while preserving existing `loft.*` keys in `frontend/src/stores/useSfxStore.ts`.
- [X] T042 [US5] Wire successful local mute/unmute, camera on/off, and screen start/end actions to UI SFX without emitting realtime sound commands in `frontend/src/features/room/RoomSession.tsx`.
- [X] T043 [US5] Map authoritative room entry/join/leave/reconnect/disconnect/removal/host-transfer/raise-hand facts through local room-sound policy, explicitly leaving reaction/chat silent, in `frontend/src/features/room/RoomSession.tsx` and `frontend/src/lib/sfx.ts`.
- [X] T044 [US5] Add simple localized Sound Effects, Room Sounds, and SFX volume controls to the existing settings surface without one-toggle-per-sound in `frontend/src/components/room/RoomSettings.tsx`, `frontend/src/lib/i18n/dictionaries/en.ts`, and `frontend/src/lib/i18n/dictionaries/vi.ts`.

**Checkpoint**: US5 degrades completely without affecting room/call behavior.

---

## Phase 8: User Story 6 - Accessible Responsive Controls (Priority: P2)

**Goal**: Make every social action and state usable across required viewports, keyboard, screen reader, and reduced motion.

**Independent Test**: Complete Reaction, Wave, and Raise/Lower Hand with keyboard/touch at every required width and with reduced motion/screen share.

### Tests for User Story 6

- [ ] T045 [P] [US6] Add component accessibility tests for names, `aria-expanded`, Raise Hand pressed/state semantics, Escape dismissal, roving/focus order, and focus return in `frontend/src/components/room/SocialActions.test.tsx`.
- [ ] T046 [P] [US6] Add layout/reduced-motion tests for 1440, 1280, 1024, 768, 430, and 375 widths, screen-share priority, maximum 6 social groups, and stable media keys in `frontend/src/features/room/stageLayout.test.ts` and `frontend/src/features/room/RoomView.test.tsx`.

### Implementation for User Story 6

- [X] T047 [US6] Extract the Call Dock reaction/Wave/hand popover into an accessible reusable component with keyboard/touch behavior and predictable focus return in `frontend/src/components/room/SocialActions.tsx` and integrate it in `frontend/src/features/room/RoomView.tsx`.
- [X] T048 [US6] Apply reduced-motion variants that preserve attribution/hand meaning while limiting nonessential spatial motion to 160ms or less in `frontend/src/features/room/RoomView.tsx`, `frontend/src/features/room/RoomSession.tsx`, and `frontend/src/app/globals.css`.
- [ ] T049 [US6] Ensure social overlays remain pointer-safe and do not overlap shared content, participant strip, Call Dock, or chat at all required widths in `frontend/src/features/room/RoomView.tsx` and `frontend/src/app/globals.css`.
- [X] T050 [US6] Add localized textual alternatives for every reaction, Wave, raised/lowered state, limit error, and SFX control in `frontend/src/lib/i18n/uiText.ts`, `frontend/src/lib/i18n/dictionaries/en.ts`, and `frontend/src/lib/i18n/dictionaries/vi.ts`.

**Checkpoint**: US6 meets keyboard, assistive-technology, reduced-motion, and responsive acceptance.

---

## Phase 9: Polish & Cross-Cutting Validation

**Purpose**: Document architecture and verify the full feature without overstating unverified environments.

- [X] T051 [P] Update social event, presence, Redis degradation, backpressure, and source-of-truth documentation in `docs/realtime-protocol.md`, `docs/presence.md`, `docs/redis.md`, and `docs/room-state.md`.
- [X] T052 [P] Update current product behavior and known SFX/AFK limitations in `README.md` and `specs/003-social-reactions-presence/quickstart.md`.
- [X] T053 Run `go test ./...`, `go test -race ./...`, `go vet ./...`, and `go build ./...` from `backend/` and record exact results in `specs/003-social-reactions-presence/quickstart.md`.
- [X] T054 Run `npx tsc --noEmit`, `npm run test -- --run`, `npm run lint`, and `npm run build` from `frontend/` and record exact results in `specs/003-social-reactions-presence/quickstart.md`.
- [ ] T055 Execute the two-instance Redis healthy/outage/recovery, rate-limit bypass, reconnect, stale-close, kick/ban, and backward-compatibility matrix and record PASS/FAIL/NOT VERIFIED in `specs/003-social-reactions-presence/quickstart.md`.
- [ ] T056 Execute Chrome acceptance at 1440, 1280, 1024, 768, 430, and 375 widths for Stage/screen-share, keyboard, touch, reduced motion, autoplay block, SFX preference isolation, and LiveKit track stability; record evidence in `specs/003-social-reactions-presence/quickstart.md`.
- [X] T057 Audit repository changes to confirm no PostgreSQL migration, second presence/realtime/SFX authority, server sound command, durable reaction history, automatic AFK, arbitrary emoji/content, unbounded goroutine/timer/listener, or unexplained old-brand user copy was introduced; record findings in `specs/003-social-reactions-presence/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** starts immediately.
- **Foundational (Phase 2)** depends on Setup and blocks every story.
- **US1, US2, and US4 (P1)** begin after Foundational. US4 integration should run after US2's social-state model, although its tests can be prepared in parallel.
- **US3, US5, and US6 (P2)** begin after Foundational; US6 final integration depends on US1–US3 controls, and US5 room-fact wiring benefits from US2/US3 facts.
- **Polish (Phase 9)** follows all stories selected for release.

### User Story Dependency Graph

```text
Setup → Foundation ─┬→ US1 Reactions ───────────┐
                    ├→ US2 Raise Hand → US4 Presence ─┤→ US6 Accessibility/Responsive
                    ├→ US3 Wave ────────────────┤
                    └→ US5 SFX (policy independent; fact wiring follows US2/US3)
All selected stories → Polish & acceptance
```

### Parallel Opportunities

- T002 and T003 run in parallel after T001.
- T005, T007, T008, and T009 can be prepared independently around T004/T006.
- US1 tests T010–T012 run in parallel.
- US2 tests T017–T020 run in parallel.
- US4 tests T026–T027 run in parallel.
- US3 tests T031–T032 run in parallel.
- US5 tests T036–T038 run in parallel; asset review T039 can proceed beside manager/store implementation after T038.
- US6 tests T045–T046 run in parallel.
- Documentation T051–T052 runs in parallel once behavior stabilizes.

## Parallel Execution Examples

### US1

```text
Task T010: backend reaction contract/security tests
Task T011: distributed/burst/slow-consumer tests
Task T012: frontend grouping/expiry tests
```

### US2

```text
Task T017: domain/version tests
Task T018: lifecycle race tests
Task T019: multi-instance/presence tests
Task T020: frontend reconciliation tests
```

### US5

```text
Task T036: preference/policy tests
Task T037: playback manager tests
Task T038: asset manifest validation
```

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational.
2. Complete US1 reactions (T010–T016).
3. Stop and validate the five-value reaction MVP independently.

### Incremental Delivery

1. US1: final reactions.
2. US2 + US4: Raise Hand with trustworthy lifecycle.
3. US3: room-level Wave.
4. US5: optional SFX after assets are approved.
5. US6: consolidated accessibility/responsive acceptance.
6. Full polish and environment matrix.

## Notes

- Tests precede implementation and must fail for the intended missing behavior.
- Never mark environment-dependent T055/T056 PASS without actually executing them.
- Root WAV files are user-owned/untracked until T002/T039 validates and intentionally selects them.
- No database migration is expected.
- Commit after each task or cohesive task group.
