# Skill: Redis Ephemeral Coordination & Pub/Sub

## Trigger
Use this skill whenever modifying Redis keys, presence TTL expiration, Pub/Sub channel subscriptions, distributed rate limit counters, or multi-instance event routing.

## Goals
- Maintain Redis strictly as an ephemeral coordination layer.
- Enforce mandatory TTLs on all dynamic presence and rate-limiting keys.
- Prevent Redis Pub/Sub from being treated as a durable event log.
- Guarantee graceful fallback when Redis is absent or disconnected.

## Required reading
- [redis.md](file:///d:/git/Loft/docs/redis.md)
- [presence.md](file:///d:/git/Loft/docs/presence.md)
- [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md)

## Source of truth
- Ephemeral presence TTLs and distributed rate limit counters reside in Redis.
- Durable business truth resides in PostgreSQL.

## Invariants
- **ZERO DURABLE DATA IN REDIS:** If Redis is wiped, no permanent data is lost.
- Every presence key must have a strict TTL (15 seconds).
- Redis Pub/Sub messages are fire-and-forget; never assume guaranteed delivery or durable replay.
- The Go backend must cleanly fall back to in-memory channels and local presence if `REDIS_URL` is omitted.

## Workflow
1. When storing ephemeral presence: use `SETEX presence:room:<id>:<user>:<conn> 15 <json>`.
2. When publishing cross-instance events: publish typed envelope to channel `room:<room_id>:events`.
3. In `RoomHub`, subscribe to Redis channel and forward inbound events to local room connections.
4. Ensure all Redis calls pass `ctx` with bounded timeout (e.g. 500ms).

## Implementation rules
- **WHAT TO DO:** Set explicit TTLs on every single write (`SETEX` or pipeline with `EXPIRE`).
- **WHAT NOT TO DO:** Never write unbounded keys without TTLs; never store permanent room records in Redis.
- **WHY:** Unbounded keys cause memory bloat and eventual Redis OOM crashes.
- **HOW TO VERIFY IT:** Run `redis-cli TTL <key>` in test environment and assert expiration.

## Failure cases
- If Redis returns connection refused, trip the fallback circuit breaker, log a warning, and route room events locally in-memory.

## Security considerations
- Use Redis AUTH / TLS when connecting to managed Redis in production.
- Sanitize room ID and user ID strings in key names to prevent key injection.

## Testing
- Integration test with real Redis: verify presence key expires automatically after 15 seconds.
- Test Pub/Sub fan-out between two simulated Go server instances.

## Verification
- Ephemeral presence disappears upon timeout.
- Backend boots and passes test suite even when Redis is stopped.

## Common mistakes
- Relying on Redis Pub/Sub for historical event replay (Pub/Sub does not buffer history; use `room.snapshot`).

## Completion report
Upon finishing changes, summarize:
1. Redis keys and TTLs configured.
2. Pub/Sub channels and subscriber loops.
3. Fallback behavior verified when Redis is disconnected.
