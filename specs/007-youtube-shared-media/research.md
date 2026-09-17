# Research: YouTube Experience, Discovery & Shared Queue

## Decision: Use the existing IFrame Player API renderer

**Rationale**: Current `MusicPlayback` already owns the official iframe and canonical state reconciliation. Keep it mounted while drawer tabs change. YouTube documents a minimum embedded viewport and official player error codes; error 100 means removed/private, 101/150 means embedding disallowed, and 153 indicates missing referer/client identification.

**Alternatives considered**: Replacing the player with a custom video/audio pipeline (rejected: violates media boundary and YouTube policy).

## Decision: Use Data API search only behind bounded server mediation

**Rationale**: `search.list` is the official discovery method and supports bounded results; quota costs and project allocation must be treated as a product limit. Debounce, normalize, cap result count, and cache short-lived normalized queries. Label output as search results or Suggested, never as YouTube recommendations without official support.

**Alternatives considered**: iframe search list (deprecated), client-direct API calls (leaks credentials and bypasses quota control), custom recommendation ML (out of scope).

## Decision: Validate embeddability at selection/playback boundaries

**Rationale**: Search metadata cannot guarantee playback. Player errors must mark an item unavailable and allow safe skip/recovery without blocking the room.

## Decision: Autoplay is a room-authoritative transition

**Rationale**: Only Go room authority may choose one candidate after explicit queue exhaustion. Clients report end events idempotently; they never independently select a next video.

## Decision: Media palette is local presentation state

**Rationale**: Thumbnail-derived colors are sanitized and clamped in the browser, cached by video ID, and applied through existing atmosphere modes. No arbitrary CSS or palette payload crosses realtime boundaries.

## Policy verification sources

- IFrame player parameters and minimum viewport: https://developers.google.com/youtube/player_parameters
- IFrame API error codes and API reference: https://developers.google.com/youtube/iframe_api_reference
- Search API and quota: https://developers.google.com/youtube/v3/docs/search/list
- Quota overview: https://developers.google.com/youtube/v3/getting-started
- Embedded player minimum functionality and referer identity: https://developers.google.com/youtube/terms/required-minimum-functionality
