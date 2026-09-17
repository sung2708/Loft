# Feature Specification: YouTube Experience, Discovery & Shared Queue

**Feature Branch**: `007-youtube-shared-media`  
**Created**: 2026-09-17  
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Search and add shared YouTube media (Priority: P1)

Participants can search YouTube or paste a supported link in the existing media drawer, preview compact metadata, then explicitly choose Play Now or Add to Queue. Existing paste-link behavior remains supported.

**Independent Test**: Search a known video, preview it, add it to the queue, and confirm all participants receive the same canonical queue update.

**Acceptance Scenarios**:

1. **Given** a valid watch, short, or supported Shorts URL, **When** submitted, **Then** Mingly normalizes it and shows a preview without changing playback until an explicit action.
2. **Given** ordinary search text, **When** typing pauses, **Then** bounded results show thumbnail, title, channel, and useful duration information.
3. **Given** malformed, unavailable, non-embeddable, empty, quota-exhausted, or failed input, **When** submitted, **Then** a calm actionable state appears without affecting room calls.

### User Story 2 - Deterministic shared playback (Priority: P1)

Authorized roles can Play Now, pause, seek, reorder, remove, and clear according to existing host permissions. Members can add or suggest according to the existing room policy.

**Independent Test**: Two clients observe Play Now, seek, pause, queue progression, reconnect, and late-join convergence from one room snapshot.

**Acceptance Scenarios**:

1. **Given** an authorized Play Now, **When** accepted, **Then** Go room authority updates canonical state and all players converge to the same video and timeline.
2. **Given** an unauthorized mutation, **When** submitted, **Then** it is rejected server-side without changing canonical state.
3. **Given** multiple clients report one video ended, **When** reports arrive, **Then** exactly one canonical transition occurs.
4. **Given** explicit queue items exist, **When** the current video ends, **Then** the next queued item wins over discovery suggestions.
5. **Given** reconnect or late join, **When** a fresh snapshot arrives, **Then** media, effective position, queue, autoplay, picks, and atmosphere converge without replaying command history.

### User Story 3 - Room Picks (Priority: P2)

Participants can suggest videos without forcing playback, vote once per stable identity, and authorized hosts can promote a pick into the canonical queue while suggestion and queue identities remain distinct.

### User Story 4 - Room-authoritative autoplay (Priority: P2)

Authorized hosts can enable Autoplay suggestions. It defaults off; after explicit queue exhaustion one authoritative safe candidate is selected for everyone, never independently per client.

### User Story 5 - Media-adaptive atmosphere (Priority: P3)

When enabled, Mingly may derive a sanitized palette from current thumbnail/artwork and apply it according to the selected atmosphere. Manual accent is the fallback; no audio mood or emotion inference is performed.

## Edge Cases

- Deleted, private, region-restricted, age-restricted, or non-embeddable videos must not permanently stall the queue.
- Search quota exhaustion and provider outages must not affect chat, presence, voice, camera, or screen share.
- Duplicate end events, stale versions, duplicate queue items, repeated votes, and reconnect races must be idempotent.
- Background tabs must resynchronize on return without aggressive polling.
- Screen share remains Stage priority; chat links create previews/actions only and never change playback automatically.
- Mobile controls must avoid participant strips, call dock, and safe areas.

## Requirements

### Functional Requirements

- **FR-001**: Extend the existing canonical media state, queue, snapshots, WebSocket events, Redis coordination, player renderer, and host authorization; do not create parallel sources of truth.
- **FR-002**: The existing drawer MUST accept both YouTube URLs and search text through one coherent input.
- **FR-003**: URL handling MUST validate hosts and IDs, support practical watch/short/Shorts forms, reject malformed input calmly, and disallow arbitrary embed HTML.
- **FR-004**: Search MUST debounce, bound results, handle loading/empty/error/quota/unavailable/non-embeddable states, and avoid requests on every render.
- **FR-005**: Results MUST expose compact playback metadata and explicit Play Now/Add to Queue actions.
- **FR-006**: Playback and queue mutations MUST use centralized server authorization and optimistic version checks.
- **FR-007**: Queue items MUST have stable identity, provider ID, safe metadata, attribution, and ordering; array index is not durable identity.
- **FR-008**: Room Picks MUST be separate entities with attribution, duplicate filtering, bounded retention, and one vote per stable participant identity.
- **FR-009**: Autoplay MUST default off, be room-authoritative, and activate only after explicit queue exhaustion.
- **FR-010**: Multiple ended reports MUST produce one idempotent transition and preserve source/version feedback-loop protections.
- **FR-011**: Reconnect and late-join snapshots MUST include current media, effective position, queue, autoplay, picks, and relevant atmosphere state.
- **FR-012**: YouTube MUST continue through the official embedded/IFrame mechanism; no YouTube audio/video may pass through Go WebSocket or LiveKit.
- **FR-013**: Unavailable media MUST expose safe recovery/skip behavior without stalling unrelated room features.
- **FR-014**: Media-adaptive visuals MUST use sanitized palette values, preserve selected atmosphere precedence, transition subtly, and respect reduced motion.
- **FR-015**: Existing chat, presence, reactions, calls, screen share, effects, room URLs, snapshots, mobile layouts, and paste-link behavior MUST remain healthy.
- **FR-016**: Diagnostics MUST cover search/quota/player failures, transitions, duplicate-end suppression, sync corrections, unavailable skips, suggestion failures, and palette fallback without per-frame noise or secrets.

### Key Entities

- **Media State**: Canonical current media, playback status, timestamp anchor, rate, version, and updater.
- **Queue Item**: Stable explicit playback intent with provider ID, safe metadata, attribution, and ordering.
- **Room Pick**: Social suggestion with independent identity, attribution, votes, and lifecycle.
- **Suggested Candidate**: Bounded discovery candidate labeled Suggested, not falsely labeled YouTube-recommended.
- **Media Visual Context**: Sanitized palette data derived from visual media, never arbitrary CSS.

## Success Criteria

- **SC-001**: 95% of valid paste/search submissions show an actionable preview within 2 seconds under normal provider availability.
- **SC-002**: 95% of authorized playback and queue actions converge for connected clients within 2 seconds.
- **SC-003**: 100% of tested simultaneous end-event bursts produce exactly one queue transition.
- **SC-004**: 100% of reconnect/late-join tests converge to authoritative media without replaying history.
- **SC-005**: 100% of unauthorized mutations are rejected without canonical state changes.
- **SC-006**: Search/discovery creates no continuous polling and does not degrade calls or realtime room features during a 30-minute session.
- **SC-007**: 100% of tested unavailable videos fail gracefully without permanently blocking the queue.
- **SC-008**: Palette transitions never flash/strobe; reduced-motion users receive no decorative motion.

## Assumptions

- Existing YouTube playback, queue, authority, snapshots, Redis behavior, player lifecycle, and Room Atmosphere are extended, not rebuilt.
- Search requires a configured YouTube Data API project and accepted quota/policy cost.
- Only safe metadata and official embeds are used; Mingly never proxies, downloads, extracts, or restreams YouTube media.
- Existing host/moderator semantics remain authoritative.
- Room Picks, Suggested, and autoplay are bounded MVP3 features, not recommendation ML or reputation systems.

## Unresolved Product Decisions

1. Whether members may directly add to queue or must submit Room Picks for host approval.
2. Whether an unavailable current item auto-skips immediately, waits for host action, or uses a grace period.
3. Whether autoplay may use only recent room context or also current search context.

## YouTube API/Policy Constraints for Planning Verification

1. Confirm current Data API quota allocation, search quota cost, and project status.
2. Confirm metadata retention/cache and attribution/branding requirements.
3. Confirm embed errors for private, deleted, restricted, and non-embeddable videos, including referer/client identification requirements.
4. Confirm production origin/referrer policy and current restrictions on nested iframe/player behavior.
