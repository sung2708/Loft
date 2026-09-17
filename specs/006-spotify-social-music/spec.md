# Feature Specification: Spotify Social Music & Personal Playback (Experimental)

**Feature Branch**: `006-spotify-social-music`

**Created**: 2026-09-17

**Status**: Draft — Optional / Experimental MVP3 extension

**Input**: User description: "Account-level Spotify OAuth that persists across rooms, with private playback, room suggestions, and explicitly room-scoped listening visibility."

## Product Boundary

Spotify is an optional personal playback and social discovery integration. Spotify remains the authority for catalog, account, playback, and devices. Mingly does not redistribute Spotify audio and does not provide synchronized Spotify playback. YouTube shared playback remains unchanged.

The Spotify connection belongs to the authenticated Mingly account, never to a room. Users authorize once and may use supported personal features in later rooms without repeating OAuth solely because rooms changed. Connection does not disclose listening activity. Any listening visibility is private by default and must be explicitly enabled per room/session.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect Once, Use Across Rooms (Priority: P1)

An authenticated Mingly user connects Spotify from account settings and can later use supported Spotify features in another room without another authorization prompt.

**Why this priority**: Account-level ownership and repeatable authorization are the foundation for a safe, usable integration.

**Independent Test**: Connect in Room A, leave, enter Room B, and verify personal Spotify features are available after normal session bootstrap without a new OAuth flow.

**Acceptance Scenarios**:

1. **Given** an authenticated user with no Spotify connection, **When** they approve the Spotify authorization request, **Then** the account shows Spotify connected and the room remains otherwise unchanged.
2. **Given** the user connected Spotify in Room A, **When** they leave and enter Room B, **Then** no OAuth is requested solely due to the room change.
3. **Given** the user declines or disconnects Spotify, **When** they use Mingly, **Then** Mingly authentication, room membership, and core room participation continue normally.

### User Story 2 - Search and Listen Privately (Priority: P1)

A connected user searches for tracks, views safe catalog metadata, and chooses “Play for me” on their own supported Spotify account or device.

**Why this priority**: Personal playback delivers the primary Spotify value without creating a group-audio boundary violation.

**Independent Test**: Search for a known track, play it privately, and verify only the user’s Spotify session changes; Mingly shared media and other participants do not change.

**Acceptance Scenarios**:

1. **Given** a connected eligible account, **When** the user searches for a track, **Then** results show title, artist, permitted artwork/metadata, and an option to play privately or open Spotify.
2. **Given** a user selects “Play for me”, **Then** playback affects only that user’s authorized Spotify session and does not modify YouTube room media, room queue, LiveKit, or other users’ playback.
3. **Given** playback is unavailable because of account, device, browser, or provider restrictions, **Then** the user receives a clear fallback such as “Open in Spotify” and can continue participating in Mingly.

### User Story 3 - Discover Music Together Without Sharing Audio (Priority: P2)

A participant suggests a Spotify track to the current room, and participants can view, react to, or vote on a lightweight Room Pick while choosing private playback for themselves.

**Why this priority**: Social discovery provides room value while preserving personal playback and provider boundaries.

**Independent Test**: Add a suggestion, view it from another participant, vote once, and select private playback without changing room media.

**Acceptance Scenarios**:

1. **Given** a participant in a room, **When** they choose “Suggest to room”, **Then** the room receives safe track metadata and attribution to the suggester, not audio or credentials.
2. **Given** an existing Room Pick for the same Spotify track, **When** another participant suggests it, **Then** the existing pick is socially highlighted or counted rather than duplicated.
3. **Given** a participant views a Room Pick, **When** they choose “Play for me”, **Then** only their personal Spotify session changes.
4. **Given** a participant votes on a Room Pick, **When** they vote again, **Then** duplicate voting is prevented according to existing Mingly participant identity semantics.

### User Story 4 - Share Listening Intentionally Per Room (Priority: P2)

A connected user may explicitly share safe current-listening metadata in one room while remaining private in other rooms.

**Why this priority**: Listening presence can be social, but it must not be inferred from account connection or leak across room boundaries.

**Independent Test**: Enable “Share in this room” in Room A, keep it off in Room B, and verify activity appears only in Room A; leaving Room A removes its activity.

**Acceptance Scenarios**:

1. **Given** Spotify is connected and listening sharing is off, **When** the user listens, **Then** no room receives current-track metadata.
2. **Given** the user explicitly enables sharing in Room A, **Then** Room A may show safe track/artist metadata and private account details remain hidden.
3. **Given** the same user has Room B open with sharing off, **Then** Room B receives no activity from Room A.
4. **Given** the user leaves a room while sharing, **Then** that room’s activity disappears while the account connection remains active.

### User Story 5 - Recover Safely From Provider and Room Failures (Priority: P3)

Users can continue using Mingly when Spotify authorization, quota, availability, or provider services fail.

**Why this priority**: Spotify is optional and must not weaken core realtime room reliability.

**Independent Test**: Simulate expired authorization, rate limiting, outage, backend restart, and room reconnect; verify core Mingly features remain usable and no credentials leak.

**Acceptance Scenarios**:

1. **Given** an expired or revoked Spotify authorization, **When** a Spotify action is attempted, **Then** the user is asked to reconnect while chat, presence, LiveKit, YouTube, and room controls remain available.
2. **Given** a provider rate limit or outage, **Then** the integration backs off and reports a recoverable error without blocking room participation.
3. **Given** a room reconnect or backend restart, **Then** no Spotify token appears in snapshots/events and room-scoped sharing is restored only according to the user’s explicit effective visibility.

### Edge Cases

- Non-Premium, unauthorized development user, unsupported browser, unavailable device, denied consent, revoked access, expired token, provider 429, outage, and malformed provider metadata.
- Guest participants can see permitted Room Picks and use public/open-in-Spotify actions where appropriate but are not required to authenticate or connect Spotify to join a room.
- Multiple rooms/tabs share one account-level Spotify connection; visibility remains independently scoped to each authorized room/session.
- Disconnecting Spotify removes or revokes the account integration according to supported provider behavior, stops room activity, and does not sign the user out or alter room membership.
- Room Picks must not become a shared playback queue and must have bounded retention defined during planning.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST model Spotify authorization as an account-level optional integration independent of rooms, memberships, host status, and Mingly identity.
- **FR-002**: System MUST avoid repeating Spotify authorization solely when a user changes rooms, rejoins, reconnects a room, or refreshes a room page.
- **FR-003**: System MUST keep Spotify credentials out of room records, snapshots, realtime events, LiveKit metadata, Redis room state, chat, and logs.
- **FR-004**: System MUST use the currently supported Spotify authorization flow, exact redirect handling, least-privilege scopes, secure token lifecycle, refresh/expiry handling, and disconnect/revocation behavior; current official requirements MUST be verified during planning.
- **FR-005**: System MUST allow connected users to search supported Spotify catalog content with debounced requests, loading/no-result/provider-error states, quota-aware behavior, and no unnecessary request repetition.
- **FR-006**: System MUST provide “Play for me” and supported personal controls that affect only the owning user’s Spotify account/device.
- **FR-007**: System MUST provide an “Open in Spotify” fallback when embedded or browser playback is unavailable.
- **FR-008**: System MUST NOT transport, capture, decode, record, relay, or republish Spotify audio through Mingly WebSocket, LiveKit, Go, Redis, Postgres, browser capture, or custom media services.
- **FR-009**: System MUST NOT implement synchronized Spotify group playback, shared Spotify queue semantics, or force controls across participants.
- **FR-010**: System MUST allow eligible participants to create Room Picks containing only safe, permitted metadata, stable suggestion identity, attribution, provider link/URI, timestamps, and lightweight vote/reaction state.
- **FR-011**: System MUST deduplicate repeated suggestions for the same Spotify track according to defined room identity semantics.
- **FR-012**: System MUST keep Room Picks distinct from the existing shared YouTube queue and canonical media state.
- **FR-013**: System MUST default listening visibility to private and require an explicit room/session choice before exposing current-track metadata.
- **FR-014**: System MUST scope listening activity to the room/session where sharing was enabled and MUST prevent activity from leaking to other rooms or tabs where sharing is disabled.
- **FR-015**: System MUST never expose Spotify email, private account ID, OAuth tokens, private playlists, or unrelated listening history to room participants.
- **FR-016**: System MUST stop room-visible listening activity when the user leaves that room or disconnects Spotify while retaining account-level connection semantics until explicitly disconnected.
- **FR-017**: System MUST support guests viewing permitted Room Picks without requiring Spotify or Mingly authentication solely for room participation.
- **FR-018**: System MUST isolate Spotify failures from chat, presence, reactions, LiveKit, camera, microphone, screen sharing, YouTube, and normal room participation.
- **FR-019**: System MUST rate-limit and handle provider search, playback commands, listening-state updates, suggestions, and votes while respecting current quota and retry guidance.
- **FR-020**: System MUST apply current Spotify attribution, branding, developer-mode, Premium, policy, and content restrictions and MUST not claim unsupported recommendation capabilities.
- **FR-021**: System MUST keep account management in the profile/settings connected-apps surface while room UI focuses on search, private playback, suggestions, Room Picks, and explicit per-room sharing.

### Key Entities

- **Spotify Connection**: Account-level optional relationship containing provider identity, granted capabilities/scopes, authorization lifecycle state, and disconnect status; never room data.
- **Spotify Personal Playback**: User-owned provider playback/session state and supported device capability; never canonical room media.
- **Room Pick**: Room-scoped safe Spotify metadata suggestion with stable ID, track reference, attribution, timestamps, and bounded social reaction/vote state.
- **Spotify Room Visibility**: Explicit room/session sharing choice determining whether safe current-listening metadata is visible in that room; distinct from connection and playback.
- **Listening Activity**: Ephemeral room-visible safe metadata published only while visibility is authorized; removed on room leave or sharing disablement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 95% of users who connect Spotify can enter a second room and use personal Spotify features without a new authorization prompt, excluding explicit revocation/expiry or provider-required reconsent.
- **SC-002**: 100% of tested Spotify playback actions affect only the initiating user’s Spotify session and never alter Mingly shared media or another participant’s playback.
- **SC-003**: 100% of privacy tests confirm listening metadata appears only in rooms with explicit sharing enabled and never in other active rooms/tabs.
- **SC-004**: 100% of tested room snapshots, realtime events, logs, and LiveKit metadata contain no Spotify credentials or tokens.
- **SC-005**: 95% of valid searches return either results or a clear provider/no-result state within 3 seconds under normal provider conditions.
- **SC-006**: 100% of provider failure tests leave core room participation, chat, presence, and existing YouTube/media functionality usable.
- **SC-007**: In usability testing, at least 90% of participants correctly understand that “Play for me” is private and that connecting Spotify does not share listening activity.

## Assumptions

- The existing authenticated Mingly identity, profile/settings surfaces, room authority, realtime protocol, persistence, and rate-limiting patterns are extended rather than replaced.
- Spotify policy, Web API, Web Playback SDK, OAuth, Premium, Development Mode, quota, rate-limit, attribution, and branding requirements may change; planning must verify current official documentation before implementation.
- Personal playback support is limited to capabilities and account/device/browser combinations currently permitted by Spotify; unsupported cases use Open in Spotify.
- Room Picks are lightweight and bounded; exact retention, persistence, and moderation details are decided during planning.
- Guests remain able to join rooms without authentication requirements introduced by this optional integration.

## Spotify Policy / Platform Constraints Requiring Verification

- Current recommended OAuth flow, PKCE/state requirements, redirect URI rules, token storage/refresh/revocation expectations, and minimum scopes.
- Current Web API, Web Playback SDK, Spotify Connect, Premium, supported browser/device, autoplay, and personal playback-control requirements.
- Current Development Mode eligibility, allowed users, quota/rate limits, retry guidance, and portfolio/demo restrictions.
- Current Spotify Developer Policy on audio capture/redistribution, content storage, metadata/artwork use, recommendation/ML use, AI training, and required attribution/branding.
- Whether each desired catalog, playback, listening-state, recently-played, top-items, and device capability remains available under current platform rules.
- Final Room Pick retention, moderation, duplicate semantics, and account-default versus room/session visibility persistence.

