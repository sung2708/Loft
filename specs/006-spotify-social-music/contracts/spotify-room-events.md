# Contract: Spotify Room Semantic Events

These are room-control-plane semantic events only. They contain safe metadata, never credentials or audio.

## `spotify.pick.added`

Payload: `pick_id`, `room_id`, `track_reference`, `title`, `artists`, permitted artwork/link, `suggested_by`, `created_at`, and initial reaction/vote summary.

Authorization: authenticated room participant with a valid room membership. Server validates provider reference, metadata policy, duplicate semantics, and rate limits.

## `spotify.pick.voted`

Payload: `pick_id`, voter-safe identity reference, vote/reaction delta, resulting bounded summary, and room version.

Authorization: current room participant; server prevents duplicate votes and stale-version mutations.

## `spotify.activity.updated`

Payload: room-scoped user display reference, safe track/artist metadata, provider link, visibility version, and timestamp.

Authorization: emitted only when the user explicitly enabled sharing for this room/session. It is never emitted globally from account connection or personal playback alone.

## `spotify.activity.cleared`

Payload: room-scoped user reference, reason (`disabled`, `left`, `disconnected`, `expired`, or `stale`), and room version.

## Forbidden fields and behaviors

- OAuth access/refresh tokens, client secrets, email, private provider IDs, private playlists, unrelated listening history, or raw provider credentials.
- Audio bytes, capture references, stream URLs, or playback commands targeting another participant.
- Any event that mutates the canonical YouTube media state or acts as synchronized Spotify playback.
