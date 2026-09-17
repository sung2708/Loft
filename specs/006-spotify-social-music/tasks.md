# Tasks: Spotify Social Music & Personal Playback

**Input**: Design documents from `/specs/006-spotify-social-music/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Organization**: Tasks are grouped by independently testable user story. Spotify remains optional and experimental throughout.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish configuration and documentation boundaries without changing existing room behavior.

- [X] T001 Add Spotify feature flags, client ID, exact redirect URI, and provider endpoint configuration placeholders to `backend/internal/config/config.go` and `backend/.env.example`, keeping client secrets server-side.
- [X] T002 [P] Add typed Spotify provider/domain contract placeholders under `backend/internal/spotify/` and `frontend/src/lib/spotify/` without exposing credentials to room types.
- [ ] T003 [P] Add Spotify UI copy and feature-availability states to `frontend/src/lib/i18n/` for connected, disconnected, Premium-required, unavailable, rate-limited, and reconnect-required states.
- [ ] T004 [P] Add the Spotify integration test matrix and media-boundary assertions to `specs/006-spotify-social-music/quickstart.md` references and repository test documentation.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build account ownership, security, typed events, and persistence primitives before story work.

**⚠️ CRITICAL**: No user story implementation may begin until this phase is complete.

- [ ] T005 Create forward-only account-level Spotify connection migration in `backend/migrations/000008_spotify_connections.up.sql` and rollback in `backend/migrations/000008_spotify_connections.down.sql`, with one active provider connection per Mingly user and no room foreign key.
- [ ] T006 Create bounded Room Picks/listening-visibility migration in `backend/migrations/000009_spotify_room_picks.up.sql` and rollback in `backend/migrations/000009_spotify_room_picks.down.sql`, including uniqueness for active `(room_id, spotify_track_reference)` and bounded vote identity.
- [ ] T007 [P] Implement encrypted Spotify credential lifecycle interfaces in `backend/internal/spotify/credentials.go`, including access-token expiry, refresh-token replacement, revocation, and explicit disconnect semantics.
- [X] T008 [P] Implement Spotify OAuth state/PKCE helpers with exact redirect validation in `backend/internal/spotify/oauth.go`; reject state mismatch, redirect mismatch, and client-secret exposure.
- [X] T009 [P] Implement provider error normalization for 401/403/429/outage/Premium/device/browser failures in `backend/internal/spotify/errors.go`, honoring `Retry-After` and quota-vs-rate-limit distinctions.
- [X] T010 Define typed room semantic event payloads and forbidden-field validation in `backend/internal/realtime/spotify_events.go` and mirror the discriminated unions in `frontend/src/lib/realtime/spotifyEvents.ts`.
- [ ] T011 [P] Add persistence interfaces and repositories for `SpotifyConnection`, `RoomPick`, and `SpotifyRoomVisibility` in `backend/internal/store/spotify.go`, excluding tokens and private provider fields from room snapshots.
- [X] T012 [P] Add foundational frontend account/provider state in `frontend/src/stores/useSpotifyStore.ts` with explicit connection, playback capability, and per-room visibility states; do not collapse them into one boolean.
- [ ] T013 Add server authorization helpers for account ownership, room membership, suggestion permissions, vote deduplication, and visibility isolation in `backend/internal/domain/spotify.go`.
- [ ] T014 Add foundational tests for migrations, OAuth state/PKCE, forbidden event fields, authorization, and no-audio/no-token invariants in `backend/internal/spotify/*_test.go`, `backend/internal/domain/spotify_test.go`, and `backend/internal/realtime/spotify_events_test.go`.

**Checkpoint**: Account ownership, secure provider lifecycle, typed semantic events, and persistence boundaries are ready; core Mingly behavior remains unchanged.

---

## Phase 3: User Story 1 - Connect Once, Use Across Rooms (Priority: P1) 🎯 MVP

**Goal**: Connect Spotify once at account level and bootstrap the same integration in later rooms without room-scoped reauthorization.

**Independent Test**: Connect in Room A, leave, enter Room B, and confirm no OAuth prompt occurs solely because the room changed; disconnect without affecting Mingly identity or membership.

### Tests for User Story 1

- [ ] T015 [P] [US1] Add OAuth start/callback contract tests in `backend/internal/httpapi/spotify_oauth_test.go` covering PKCE, state, exact redirect, decline, expiry, revoke, and account-level persistence.
- [ ] T016 [P] [US1] Add browser integration coverage in `frontend/e2e/spotify-account-connection.spec.ts` for connect in Room A, Room B bootstrap, decline, disconnect, and unchanged room participation.

### Implementation for User Story 1

- [ ] T017 [US1] Implement account-level Spotify connect/callback/disconnect handlers in `backend/internal/httpapi/spotify.go` using `backend/internal/spotify/oauth.go` and `backend/internal/spotify/credentials.go`.
- [ ] T018 [US1] Add authenticated account settings “Connected Apps → Spotify” surface in `frontend/src/app/settings/` and `frontend/src/components/account/SpotifyConnectionCard.tsx` with connect, reconnect, and disconnect actions.
- [ ] T019 [US1] Add Spotify callback bootstrap and connection-status hydration in `frontend/src/app/auth/spotify/callback/page.tsx` and `frontend/src/lib/spotify/accountClient.ts` without storing provider tokens in room state.
- [ ] T020 [US1] Add room-entry bootstrap that reads account connection status but never starts a new OAuth flow solely on room change in `frontend/src/features/room/spotifyAccountBootstrap.ts` and `frontend/src/features/room/RoomSession.tsx`.
- [ ] T021 [US1] Add user-facing error and recovery behavior for declined, expired, revoked, non-Premium, Development Mode unauthorized, and disconnected states in `frontend/src/components/account/SpotifyConnectionCard.tsx` and `frontend/src/lib/spotify/errors.ts`.

**Checkpoint**: Account-level connection is independently usable across rooms and disconnecting Spotify leaves Mingly authentication, membership, and room control intact.

---

## Phase 4: User Story 2 - Search and Listen Privately (Priority: P1)

**Goal**: Search Spotify and play/control music only for the initiating user, with provider-safe fallbacks.

**Independent Test**: Search a known track, choose “Play for me”, and verify only the user’s provider session changes; YouTube, room queue, LiveKit, and other users remain unchanged.

### Tests for User Story 2

- [ ] T022 [P] [US2] Add provider-client contract tests in `backend/internal/spotify/client_test.go` for track search, token refresh, 401/403/429, Retry-After, quota errors, and bounded requests.
- [ ] T023 [P] [US2] Add frontend playback capability tests in `frontend/src/features/spotify/personalPlayer.test.ts` for Premium/account/browser/device/autoplay failures and Open-in-Spotify fallback.
- [ ] T024 [P] [US2] Add end-to-end isolation coverage in `frontend/e2e/spotify-personal-playback.spec.ts` asserting no room media or LiveKit audio mutation.

### Implementation for User Story 2

- [ ] T025 [P] [US2] Implement tracks-first Spotify provider client and debounced search service in `backend/internal/spotify/client.go` and `backend/internal/spotify/search.go`, respecting current scopes and quota guidance.
- [ ] T026 [US2] Add authenticated personal search endpoint in `backend/internal/httpapi/spotify_search.go` with bounded result payloads and safe metadata/attribution.
- [ ] T027 [P] [US2] Implement browser personal playback adapter in `frontend/src/features/spotify/personalPlayer.ts`, lazy-loading supported playback only after account connection and exposing ready/not-ready/auth/account/playback/autoplay states.
- [ ] T028 [US2] Add personal Spotify search/player UI in `frontend/src/features/spotify/SpotifyPersonalPanel.tsx` and `frontend/src/components/room/SpotifyPanel.tsx` with Search, Play for me, supported controls, and Open in Spotify.
- [ ] T029 [US2] Add provider failure isolation and telemetry-safe logging in `backend/internal/spotify/` and `frontend/src/features/spotify/`, ensuring no token, private ID, or audio payload is logged.
- [ ] T030 [US2] Add explicit tests that personal Spotify commands never call YouTube media commands or LiveKit publication paths in `backend/internal/httpapi/spotify_search_test.go` and `frontend/src/features/spotify/personalPlayer.test.ts`.

**Checkpoint**: A connected user can search and listen privately, while unsupported playback degrades without blocking Mingly.

---

## Phase 5: User Story 3 - Discover Music Together Without Sharing Audio (Priority: P2)

**Goal**: Add safe, collaborative Room Picks with deduplication and lightweight voting/reactions.

**Independent Test**: Suggest a track, view it as another participant, vote once, repeat the vote, and choose private playback without changing room media.

### Tests for User Story 3

- [ ] T031 [P] [US3] Add contract tests for `spotify.pick.added`, `spotify.pick.voted`, and duplicate rejection/update in `backend/internal/realtime/spotify_events_test.go` using `specs/006-spotify-social-music/contracts/spotify-room-events.md`.
- [ ] T032 [P] [US3] Add Room Picks integration tests in `backend/internal/domain/spotify_picks_test.go` for membership authorization, active-track uniqueness, vote deduplication, bounded retention, and guest read access.
- [ ] T033 [P] [US3] Add browser coverage in `frontend/e2e/spotify-room-picks.spec.ts` for suggest, view, vote, duplicate suggestion, and Play for me isolation.

### Implementation for User Story 3

- [ ] T034 [US3] Implement Room Pick authority, deduplication, bounded retention, and vote/reaction validation in `backend/internal/domain/spotify_picks.go` and `backend/internal/store/spotify.go`.
- [ ] T035 [US3] Add room commands and semantic broadcasts for Room Picks in `backend/internal/realtime/spotify_commands.go` and `backend/internal/realtime/spotify_events.go`, preserving non-blocking bounded broadcast behavior.
- [ ] T036 [US3] Add Room Picks rendering and actions in `frontend/src/features/room/SpotifyRoomPicks.tsx`, including suggested-by attribution, reaction/vote state, Open in Spotify, and private Play for me.
- [ ] T037 [US3] Integrate Room Picks into the existing room drawer/navigation without merging them into the YouTube queue in `frontend/src/features/room/RoomView.tsx` and `frontend/src/features/room/SpotifyRoomPicks.tsx`.

**Checkpoint**: Participants can discover and react to music metadata socially without Spotify audio or shared playback.

---

## Phase 6: User Story 4 - Share Listening Intentionally Per Room (Priority: P2)

**Goal**: Make listening presence private by default and explicitly visible only in authorized rooms/sessions.

**Independent Test**: Enable sharing in Room A, keep it off in Room B, verify activity appears only in A, then leave A and verify it disappears.

### Tests for User Story 4

- [ ] T038 [P] [US4] Add privacy isolation tests in `backend/internal/domain/spotify_visibility_test.go` for private default, room A/B isolation, multi-tab semantics, leave cleanup, disconnect cleanup, and stale activity.
- [ ] T039 [P] [US4] Add event contract tests in `backend/internal/realtime/spotify_activity_test.go` proving `spotify.activity.updated` is emitted only for explicit room visibility and forbidden globally.
- [ ] T040 [P] [US4] Add browser coverage in `frontend/e2e/spotify-listening-visibility.spec.ts` for Share in this room, disable, two rooms/tabs, leave, and reconnect.

### Implementation for User Story 4

- [ ] T041 [US4] Implement explicit room/session visibility authority and lifecycle cleanup in `backend/internal/domain/spotify_visibility.go` and `backend/internal/store/spotify.go`.
- [ ] T042 [US4] Implement provider activity projection with bounded updates and no aggressive polling in `backend/internal/spotify/activity.go`, including stale/expired/disconnected clearing.
- [ ] T043 [US4] Add typed activity update/clear handling to `backend/internal/realtime/spotify_events.go` and cross-instance coordination in `backend/internal/realtime/redis_spotify.go` without credentials.
- [ ] T044 [US4] Add account default versus room/session override controls in `frontend/src/components/account/SpotifyConnectionCard.tsx` and `frontend/src/features/room/SpotifyListeningPrivacy.tsx`, defaulting to private.
- [ ] T045 [US4] Render room-visible safe listening activity and clear it on leave/disable in `frontend/src/features/room/SpotifyListeningActivity.tsx` and `frontend/src/features/room/RoomSession.tsx`.

**Checkpoint**: Listening presence is explicit, room-isolated, and removable without disconnecting the account.

---

## Phase 7: User Story 5 - Recover Safely From Provider and Room Failures (Priority: P3)

**Goal**: Preserve all core Mingly functionality across Spotify failures, room reconnects, and backend restarts.

**Independent Test**: Simulate provider failures and room reconnect/backend restart; verify core room features remain usable and no credential/audio leakage occurs.

### Tests for User Story 5

- [ ] T046 [P] [US5] Add backend failure-isolation tests in `backend/internal/httpapi/spotify_failure_test.go` and `backend/internal/realtime/spotify_failure_test.go` for 401/403/429/outage/reconnect/restart.
- [ ] T047 [P] [US5] Add frontend failure/reconnect coverage in `frontend/e2e/spotify-failure-isolation.spec.ts` for chat, presence, reactions, YouTube, camera, microphone, and screen share remaining usable.

### Implementation for User Story 5

- [ ] T048 [US5] Implement refresh/reconnect/disconnect state transitions and bounded backoff in `backend/internal/spotify/lifecycle.go` and `backend/internal/spotify/errors.go`.
- [ ] T049 [US5] Ensure room snapshots and reconnect recovery include only safe Room Picks/visibility projections in `backend/internal/realtime/snapshot.go` and `backend/internal/realtime/spotify_events.go`.
- [ ] T050 [US5] Add frontend provider recovery UI and reauthorization flow in `frontend/src/features/spotify/SpotifyRecovery.tsx` without unmounting or disrupting existing room media/session providers.
- [ ] T051 [US5] Add security checks for redaction and media-boundary invariants to `backend/internal/observability/logger_test.go`, `backend/internal/realtime/spotify_events_test.go`, and frontend network/e2e fixtures.

**Checkpoint**: Spotify is fully optional; provider failure cannot take down Mingly room participation.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verify policy readiness, accessibility, performance, and release gates.

- [ ] T052 [P] Add Spotify attribution and branding compliance review notes to `docs/spotify.md` and link current official policy sources from `specs/006-spotify-social-music/research.md`.
- [ ] T053 [P] Add accessibility and mobile fallback review for account, search, Room Picks, and privacy controls in `frontend/src/features/spotify/` and `frontend/src/components/account/`.
- [ ] T054 [P] Add bounded-rate and performance tests for search, playback commands, activity updates, Room Picks, and votes in `backend/internal/spotify/*_test.go`.
- [ ] T055 Run the complete validation in `specs/006-spotify-social-music/quickstart.md`, including `go test -race ./...`, `go vet ./...`, `go build ./...`, frontend TypeScript, Vitest, ESLint, Playwright, and production build.
- [ ] T056 Perform a real-browser verification of OAuth redirect, autoplay/EME limitations, supported personal playback, Open-in-Spotify fallback, multi-tab visibility isolation, and no Spotify audio in LiveKit before enabling the experiment.
- [ ] T057 Update `specs/006-spotify-social-music/checklists/requirements.md` with implementation-readiness notes and document any unresolved current Spotify policy decision before `$speckit-implement`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; configuration and typed boundaries can start immediately.
- **Foundational (Phase 2)**: Depends on Setup and blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundational; MVP account connection.
- **US2 (Phase 4)**: Depends on Foundational and US1 account bootstrap.
- **US3 (Phase 5)**: Depends on Foundational and safe metadata from US2; independent of personal playback runtime after contracts exist.
- **US4 (Phase 6)**: Depends on Foundational and account lifecycle from US1; can proceed in parallel with US3 after contracts exist.
- **US5 (Phase 7)**: Depends on all preceding lifecycle/event surfaces; hardens the complete optional integration.
- **Polish (Phase 8)**: Depends on desired stories being complete.

### Parallel Opportunities

- T002–T004 can run in parallel after T001.
- T007–T012 can run in parallel after migration/config decisions, then T013–T014 integrate them.
- Within US1, OAuth backend tests/UI tests can run in parallel; within US3 and US4, backend contract tests and frontend e2e scaffolding can run in parallel.
- US3 and US4 can proceed in parallel after Foundational + US1 account lifecycle.
- T052–T054 can run in parallel before the final quickstart/browser gate.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases.
2. Complete US1 only: secure account-level connect/disconnect and cross-room bootstrap.
3. Validate US1 independently with OAuth/account tests and the Room A → Room B scenario.
4. Do not enable provider playback or room sharing until current policy and account eligibility are verified.

### Incremental Delivery

1. Add US2 personal search/playback with Open-in-Spotify fallback.
2. Add US3 metadata-only Room Picks and voting.
3. Add US4 explicit room-scoped listening visibility.
4. Add US5 failure isolation and reconnect hardening.
5. Complete policy, browser, accessibility, and release verification before experimental rollout.

## Notes

- Every task uses the required checklist format with a sequential ID and concrete file path.
- `[P]` marks only tasks that can safely work on different files without incomplete dependencies.
- No task permits Spotify audio transport, synchronized group playback, or credentials in room state.
