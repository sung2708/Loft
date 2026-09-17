# Data Model: Spotify Social Music & Personal Playback

## SpotifyConnection (account-level, durable)

- `id`, `mingly_user_id`, provider account reference, granted scopes/capabilities, connection status, created/updated timestamps, revoked/expired timestamps.
- Encrypted credential material is owned by the account integration boundary and is never serialized into room state or logs.
- One active connection per Mingly account/provider; room membership has no ownership relationship.

## SpotifyPersonalPlayback (user/provider state)

- Provider device/session capability, current provider track reference, playback capability/status, and last provider synchronization timestamp where permitted.
- Ephemeral and user-scoped; never canonical Mingly media and never broadcast by default.

## RoomPick (room-scoped, bounded durable history)

- Stable Mingly suggestion ID, room ID, Spotify track reference/URI, title, artists, permitted artwork/metadata, Spotify link, suggester identity reference, created timestamp, reaction/vote summary, status/removal metadata.
- Unique active `(room_id, spotify_track_reference)` prevents duplicate cards.
- Participant identity rules prevent duplicate votes/reactions.
- Retention and moderation are bounded and must be finalized before implementation.

## SpotifyRoomVisibility (room/session scoped)

- Mingly user reference, room/session reference, explicit sharing state, effective source (account default or room override if later introduced), updated timestamp, and expiry/leave lifecycle.
- No global broadcast relation; leaving the room removes effective visibility.

## ListeningActivity (ephemeral semantic projection)

- Room/session, user display reference, safe track/artist metadata, provider link, updated timestamp, and visibility version.
- Created only while `SpotifyRoomVisibility` permits sharing; deleted/invalidated on disable, leave, disconnect, token failure, or stale provider state.
- Must not contain email, private account ID, token, playlist data, or unrelated history.

## State transitions

`disconnected → connected → expired/revoked → disconnected`

`private → sharing-enabled(room A) → private(room A leave/disable)`

`RoomPick active → removed/moderated`; duplicate suggestions update the existing pick rather than create an unbounded duplicate.
