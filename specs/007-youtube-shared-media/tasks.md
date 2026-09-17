# Tasks: YouTube Experience, Discovery & Shared Queue

**Input**: Design documents from `/specs/007-youtube-shared-media/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**Tests**: Included because the specification requires acceptance, race, reconnect, policy, and browser verification.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add YouTube API configuration placeholders and feature flags in `backend/internal/config/config.go` and `backend/.env.example` without exposing keys to frontend code.
- [X] T002 [P] Add typed YouTube search, preview, Room Pick, autoplay, unavailable-media, and visual-context types in `frontend/src/lib/youtube/types.ts` and `backend/internal/youtube/types.go`.
- [X] T003 [P] Add user-facing search, quota, unavailable, embed, and recovery copy in `frontend/src/lib/i18n/uiText.ts` and `frontend/src/lib/i18n/types.ts`.
- [ ] T004 [P] Add YouTube policy/quota verification notes and test matrix links to `specs/007-youtube-shared-media/quickstart.md` and `docs/youtube.md`.

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T005 Implement strict YouTube URL normalization for watch, youtu.be, Shorts, and explicitly supported playlist forms in `backend/internal/youtube/url.go`, rejecting malformed hosts and IDs.
- [X] T006 [P] Add URL normalization tests for valid, malformed, evil-host, unsupported-port, duplicate-query, and playlist cases in `backend/internal/youtube/url_test.go`.
- [X] T007 Implement bounded YouTube Data API client interfaces, request limits, quota/error classification, and safe metadata mapping in `backend/internal/youtube/client.go`.
- [ ] T008 [P] Add client contract tests for timeout, quota exhaustion, 4xx/5xx, empty results, bounded result count, and redacted logging in `backend/internal/youtube/client_test.go`.
- [ ] T009 Extend existing `mediaState` and snapshot serialization only where required for safe queue metadata, autoplay settings, and unavailable status in `backend/internal/realtime/media.go` and `backend/internal/realtime/hub.go`, preserving current fields and versions.
- [X] T010 [P] Add forward-only migrations for Room Picks, votes, and room autoplay settings in `backend/migrations/000010_youtube_room_picks.up.sql`, `000010_youtube_room_picks.down.sql`, `000011_youtube_media_settings.up.sql`, and `000011_youtube_media_settings.down.sql`.
- [ ] T011 Add centralized YouTube authorization evaluators for queue mutation, Pick creation/vote/promotion, autoplay settings, and host-only controls in `backend/internal/domain/youtube.go`.
- [ ] T012 [P] Define typed realtime commands/events and forbidden-field validation in `backend/internal/realtime/youtube_events.go` and `frontend/src/lib/realtime/youtubeEvents.ts` according to `contracts/youtube-room-events.md`.
- [ ] T013 Add persistence interfaces/repositories for Room Picks, votes, and media settings in `backend/internal/store/youtube.go`, excluding provider secrets and arbitrary embed HTML.
- [ ] T014 Add foundational tests for migration constraints, authorization, snapshot redaction, URL validation, and no-audio-relay invariants in `backend/internal/youtube/*_test.go`, `backend/internal/domain/youtube_test.go`, and `backend/internal/realtime/youtube_events_test.go`.

**Checkpoint**: Existing paste-link playback still works, foundation contracts are typed, and all user stories can build on one canonical media authority.

## Phase 3: User Story 1 - Search and Add Shared YouTube Media (Priority: P1) 🎯 MVP

**Goal**: Search or paste YouTube media in one drawer flow, preview safe metadata, and explicitly Play Now or Add to Queue.
**Independent Test**: Search a known video and paste a short URL from two clients; preview, queue, and canonical playback remain synchronized.

### Tests

- [ ] T015 [P] [US1] Add search endpoint contract tests for debounce-compatible bounded queries, empty/no-result, quota, provider failure, and safe metadata in `backend/internal/httpapi/youtube_search_test.go`.
- [ ] T016 [P] [US1] Add URL preview and result interaction tests for Play Now/Add to Queue/invalid states in `frontend/src/features/room/youtubeDiscovery.test.tsx`.
- [ ] T017 [P] [US1] Add browser coverage for search, paste, preview, Play Now, Add to Queue, mobile drawer, and existing paste compatibility in `frontend/e2e/youtube-discovery.spec.ts`.

### Implementation

- [X] T018 [US1] Implement authenticated bounded search and preview endpoints in `backend/internal/httpapi/youtube_search.go` using `internal/youtube` client and server-side authorization.
- [ ] T019 [US1] Add normalized search caching/rate limits and telemetry-safe failure mapping in `backend/internal/youtube/search.go` and `backend/internal/observability/`.
- [ ] T020 [US1] Build the unified Search-or-paste input, loading/error states, preview card, and explicit actions in `frontend/src/features/room/YouTubeDiscovery.tsx`.
- [ ] T021 [US1] Integrate discovery into `frontend/src/features/room/MusicDrawer.tsx` without unmounting `MusicPlayback` or changing existing queue command semantics.
- [ ] T022 [US1] Add Play Now/Add to Queue result actions through `frontend/src/features/room/RoomSession.tsx` and `frontend/src/stores/useMusicStore.ts`, preserving expected-version handling.

**Checkpoint**: Users can discover media without leaving the room and existing paste-link playback remains healthy.

## Phase 4: User Story 2 - Deterministic Shared Playback (Priority: P1)

**Goal**: Harden canonical queue progression, synchronization, unavailable handling, reconnect, late join, and duplicate-ended suppression.
**Independent Test**: Two clients perform Play Now, seek, pause, end, reconnect, and late join; both converge to one authoritative timeline.

### Tests

- [ ] T023 [P] [US2] Add duplicate-ended, stale-version, queue precedence, and unavailable-media unit tests in `backend/internal/realtime/media_test.go`.
- [ ] T024 [P] [US2] Add reconnect/late-join and background-tab clock correction tests in `frontend/src/features/room/RoomSession.test.tsx` and `frontend/src/features/room/mediaClock.test.ts`.
- [ ] T025 [P] [US2] Add two-client Play Now/seek/pause/end/reconnect browser scenarios in `frontend/e2e/youtube-shared-playback.spec.ts`.

### Implementation

- [ ] T026 [US2] Make `media.ended` generation/version idempotent and ensure one queue transition in `backend/internal/realtime/hub.go` and `backend/internal/realtime/media.go`.
- [ ] T027 [US2] Add unavailable-video classification, safe skip/recovery state, and host-visible error mapping in `backend/internal/realtime/media.go` and `frontend/src/features/room/mediaErrors.ts`.
- [ ] T028 [US2] Preserve and harden timestamp-anchor reconciliation, bounded drift correction, and player event-loop suppression in `frontend/src/features/room/MusicPlayback.tsx` and `frontend/src/features/room/mediaClock.ts`.
- [ ] T029 [US2] Ensure snapshot/reconnect includes effective media position, queue metadata, settings, and safe unavailable state in `backend/internal/realtime/hub.go` and `frontend/src/features/room/RoomSession.tsx`.
- [ ] T030 [US2] Add queue duplicate indicators and explicit Now Playing/Up Next grouping in `frontend/src/features/room/MusicDrawer.tsx`.

**Checkpoint**: Shared playback remains deterministic under concurrent events, provider failures, reconnect, and late join.

## Phase 5: User Story 3 - Room Picks (Priority: P2)

**Goal**: Support social suggestions, one-vote-per-participant, duplicate filtering, and authorized promotion into the queue.
**Independent Test**: A member suggests, another votes once, duplicate suggestion is handled, and host promotes the pick without mutating its identity.

### Tests

- [ ] T031 [P] [US3] Add Room Pick authorization, duplicate, bounded-retention, guest-read, and vote-deduplication tests in `backend/internal/domain/youtube_picks_test.go`.
- [ ] T032 [P] [US3] Add realtime pick event contract tests in `backend/internal/realtime/youtube_events_test.go`.
- [ ] T033 [P] [US3] Add browser coverage for suggest, view, vote, duplicate state, and host promotion in `frontend/e2e/youtube-room-picks.spec.ts`.

### Implementation

- [ ] T034 [US3] Implement Room Pick authority and bounded lifecycle in `backend/internal/domain/youtube_picks.go` and `backend/internal/store/youtube.go`.
- [ ] T035 [US3] Add pick commands, semantic broadcasts, and non-blocking bounded fan-out in `backend/internal/realtime/youtube_commands.go` and `backend/internal/realtime/youtube_events.go`.
- [ ] T036 [US3] Render Room Picks with attribution, vote state, duplicate/queued state, Open in YouTube, and Promote/Add actions in `frontend/src/features/room/YouTubeRoomPicks.tsx`.
- [ ] T037 [US3] Integrate Room Picks into the existing MusicDrawer tabs without mixing Pick identity with queue identity in `frontend/src/features/room/MusicDrawer.tsx` and `frontend/src/features/room/RoomView.tsx`.

**Checkpoint**: Social discovery works without automatically changing canonical playback.

## Phase 6: User Story 4 - Room-authoritative Autoplay (Priority: P2)

**Goal**: Add host-controlled autoplay suggestions with deterministic authority and explicit queue precedence.
**Independent Test**: Queue exhaustion with autoplay off stops; with autoplay on produces one shared suggested transition.

### Tests

- [ ] T038 [P] [US4] Add autoplay authorization, default-off, queue-precedence, deterministic-selection, and duplicate-ended tests in `backend/internal/realtime/autoplay_test.go`.
- [ ] T039 [P] [US4] Add settings and two-client autoplay browser coverage in `frontend/e2e/youtube-autoplay.spec.ts`.

### Implementation

- [ ] T040 [US4] Implement room media settings command, authorization, persistence, and snapshot projection in `backend/internal/domain/youtube.go`, `backend/internal/store/youtube.go`, and `backend/internal/realtime/hub.go`.
- [ ] T041 [US4] Implement bounded Suggested candidate derivation from current media/search context with explicit `Suggested` labeling in `backend/internal/youtube/suggestions.go`.
- [ ] T042 [US4] Integrate one authoritative autoplay transition after queue exhaustion in `backend/internal/realtime/hub.go` and `backend/internal/realtime/media.go`.
- [ ] T043 [US4] Add host-only autoplay control and clear UI distinction between Queue, Room Picks, and Suggested in `frontend/src/features/room/YouTubeDiscovery.tsx` and `frontend/src/features/room/SettingsDrawer.tsx`.

**Checkpoint**: Autoplay is optional, deterministic, room-scoped, and never overrides explicit queue intent.

## Phase 7: User Story 5 - Media-adaptive Atmosphere (Priority: P3)

**Goal**: Apply safe thumbnail-derived palettes through existing atmosphere modes without mood inference or flashing.
**Independent Test**: Change media and atmosphere modes, simulate extraction failure and reduced motion, and verify fallback/transition behavior.

### Tests

- [ ] T044 [P] [US5] Add palette sanitization, luminance clamp, invalid-image, cache, and fallback tests in `frontend/src/features/room/atmosphere/adaptivePalette.test.ts`.
- [ ] T045 [P] [US5] Add browser coverage for minimal/ambient/focus/party, manual accent precedence, reduced motion, and media transitions in `frontend/e2e/youtube-atmosphere.spec.ts`.

### Implementation

- [ ] T046 [US5] Extend local palette extraction/cache and sanitized MediaVisualContext in `frontend/src/features/room/atmosphere/adaptivePalette.ts`.
- [ ] T047 [US5] Integrate media palette precedence, smooth transitions, screen-share priority, and reduced-motion behavior in `frontend/src/features/room/RoomAtmosphere.tsx` and `frontend/src/app/globals.css`.
- [ ] T048 [US5] Add bounded palette fallback diagnostics without per-frame logging in `frontend/src/features/room/atmosphere/` and backend observability only where needed.

**Checkpoint**: Media-adaptive visuals are subtle, explainable, local, and do not affect calls or canonical media.

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T049 [P] Add redaction and no-proxy/no-audio-relay assertions to `backend/internal/observability/logger_test.go` and `backend/internal/realtime/youtube_events_test.go`.
- [ ] T050 [P] Run responsive accessibility review and keyboard/focus fixes for `frontend/src/features/room/YouTubeDiscovery.tsx`, `YouTubeRoomPicks.tsx`, and `MusicDrawer.tsx`.
- [ ] T051 [P] Add policy/quota/attribution review notes and operational setup to `docs/youtube.md` and `specs/007-youtube-shared-media/research.md`.
- [ ] T052 Run `go test -race ./...`, `go vet ./...`, `go build ./...`, frontend TypeScript, Vitest, lint, production build, and the `quickstart.md` validation matrix.
- [ ] T053 Perform real-browser verification of IFrame errors, referrer/client identity, search quota fallback, mobile drawer, screen share, reconnect, and reduced motion before enabling the experiment.

## Dependencies & Execution Order

### Phase Dependencies

- Setup → Foundational → User Stories 1–5 → Polish.
- User Story 1 and User Story 2 are the MVP core; US2 depends on foundational work but not on Room Picks.
- US3 depends on foundational pick persistence/events and can proceed independently from US4/US5.
- US4 depends on canonical queue/end-event hardening from US2.
- US5 depends on existing Room Atmosphere and media snapshot projection but remains presentation-local.

### Parallel Opportunities

- T002–T004 can run in parallel.
- T006, T008, T010, T012, and T014 can run in parallel after their contracts are agreed.
- Within each story, test tasks marked `[P]` can run in parallel with each other; UI and backend files can be split after foundational contracts.
- US3 and US5 can proceed in parallel after foundation; US4 follows US2 authority hardening.

## Implementation Strategy

1. Complete Setup + Foundational and preserve current paste-link playback.
2. Deliver US1 as the MVP: search/paste, preview, Play Now, Add to Queue.
3. Validate US1 and US2 together before adding social or autoplay behavior.
4. Add Room Picks, then autoplay, then atmosphere polish incrementally.
5. Stop at each checkpoint for browser and race validation; do not enable search/autoplay experiment until policy/quota checks pass.
