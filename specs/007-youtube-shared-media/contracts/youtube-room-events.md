# YouTube Room Event Contract

All events use the existing typed realtime envelope and bounded broadcast path.

## Commands

- `media.search` (authenticated request/response path; never a room mutation)
- `queue.add`, `queue.select`, `queue.next`, `queue.remove`, `queue.reorder`, `queue.clear` (existing commands, extended metadata only)
- `media.play`, `media.pause`, `media.seek`, `media.duration`, `media.ended` (existing authority semantics; ended is idempotent)
- `room.media_settings.update` with `autoplay_suggestions` and expected room version
- `youtube.pick.add`, `youtube.pick.vote`, `youtube.pick.promote`, `youtube.pick.remove`

## Events

- `media.state`: canonical current media, effective position, queue, status, version, and safe settings projection.
- `youtube.pick.added`: pick ID, room ID, safe track metadata, attribution, vote count.
- `youtube.pick.updated`: pick ID, status, vote count, and safe metadata projection.
- `youtube.pick.removed`: pick ID and reason.
- `room.media_settings.updated`: room ID, autoplay setting, settings version.
- `media.unavailable`: queue/media item ID, provider error class, and permitted recovery action; never raw provider credentials.

Forbidden event fields: access tokens, API keys, arbitrary iframe HTML, audio/video bytes, private provider account data, and unbounded provider error payloads.
