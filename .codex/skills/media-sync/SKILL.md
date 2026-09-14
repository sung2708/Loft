# Skill: Media Synchronization & Queue Management

## Trigger
Use this skill whenever modifying media playback state machines, play/pause/seek calculation math, drift correction algorithms, media queue mutations, or third-party provider adapters (YouTube, Spotify, SoundCloud).

## Goals
- Maintain strict synchronization across all room participants using server authority.
- Enforce the canonical position formula: `CurrentPos = BasePos + (Now - StartedAt)`.
- Prevent race conditions using optimistic version checks (`expected_version`).
- Keep PostgreSQL free of high-frequency playback position writes.

## Required reading
- [media-sync.md](file:///d:/git/Loft/docs/media-sync.md)
- [realtime-protocol.md](file:///d:/git/Loft/docs/realtime-protocol.md)
- [security.md](file:///d:/git/Loft/docs/security.md)

## Source of truth
- Authoritative playback state resides in Go `RoomActor.mediaState`.

## Invariants
- Continuous playback scrub positions are **never** written to PostgreSQL.
- Third-party media is **never** proxied or re-streamed by the server; clients embed official SDKs.
- Stale commands where `command.ExpectedVersion < room.version` must be rejected with `ERROR_STALE_VERSION`.
- Media URLs must be parsed, validated, and normalized to `{ provider, media_id }` before entering the queue.

## Workflow
1. For play/pause/seek commands: evaluate `CanControlMedia(actor, room)`.
2. Inspect `command.ExpectedVersion` against `RoomActor.version`.
3. Under lock: update `BasePositionMs`, set `StartedAtServerTime = time.Now()`, increment `version++`.
4. Release lock; broadcast `media.state` to room subscribers.
5. For queue mutations: evaluate `CanManageQueue(actor, room)`, validate provider URL via regex, deduplicate via `idempotency_key`.

## Implementation rules
- **WHAT TO DO:** Calculate position dynamically using server time delta.
- **WHAT NOT TO DO:** Never write periodic 1-second position ticks to the database or broadcast periodic ticks if state has not changed.
- **WHY:** High-frequency ticks create network bloat and database connection exhaustion.
- **HOW TO VERIFY IT:** Run media sync unit tests with simulated clock drift.

## Failure cases
- If a client experiences clock skew, NTP ping/pong calculates client-server offset.
- If drift is <250ms, do nothing. If 250ms–1000ms, apply soft rate adjustment (0.95x/1.05x) if supported. If >1000ms, perform hard seek.

## Security considerations
- Validate provider URLs against strict whitelist (`youtube.com`, `open.spotify.com`, `soundcloud.com`) to prevent SSRF and injection.

## Testing
- Unit test position math across PAUSED, PLAYING, and late-join scenarios.
- Concurrency test: 20 simultaneous play/pause/seek requests on the same room.

## Verification
- Stale command test returns `409 / ERROR_STALE_VERSION`.
- Position calculation matches expected millisecond offset within 5ms.

## Common mistakes
- Trusting client-calculated `current_time` instead of calculating from server anchor time.
- Adding raw user URL strings to the queue without extracting clean IDs.

## Completion report
Upon finishing changes, summarize:
1. Playback calculation adjustments made.
2. Drift thresholds and provider capabilities verified.
3. Queue mutation and SSRF validation tests.
