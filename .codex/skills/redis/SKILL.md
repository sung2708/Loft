# Skill: Redis Ephemeral Coordination & Pub/Sub

## WHEN TO USE THIS SKILL
Use this skill whenever modifying Redis keys, presence lease TTLs, Pub/Sub channel subscriptions, multi-instance event routing, or distributed rate limiting counters.

## SOURCE OF TRUTH
- **Ephemeral Presence & Rate Limits**: Redis keys with mandatory TTLs (`presence:room:*`, `ratelimit:*`).
- **Durable User Data & Room State**: PostgreSQL (`profiles`, `rooms`, `messages`).
- **Active Realtime Hub State**: Go In-Memory Maps (`state.clients`).

## ARCHITECTURAL BOUNDARIES
- Redis is strictly an **ephemeral accelerator and inter-node coordination bus**.
- Redis is **never** used as a permanent database. If Redis is flushed (`FLUSHALL`), no permanent data is lost.
- Redis Pub/Sub messages are fire-and-forget; never use Pub/Sub for historical replay or reliable event sourcing.

## REQUIRED WORKFLOW
1. **Key Naming & TTL Enforcement**:
   - Follow strict namespace: `presence:room:<room_id>:<user_id>:<conn_id>`.
   - Always set mandatory TTLs (15s for presence leases, 60s for rate limits).
2. **Multi-Instance Pub/Sub Fan-Out**:
   - Wrap inter-node messages in `InterNodeEnvelope` containing `origin_instance_id`.
   - Publish to channel `room:<room_id>:events`.
3. **Loop Prevention on Ingestion**:
   - When receiving a Pub/Sub message, check `packet.OriginInstanceID == h.instanceID`.
   - If true, **discard immediately** to prevent recursive re-broadcast loops.
   - If false, broadcast strictly to local WebSocket clients subscribing to that `room_id`.
4. **Subscription Lifecycle**:
   - Subscribe to Redis channel when first local client joins a room.
   - Unsubscribe when last local client leaves.
5. **Handle Disconnection & Fallback**:
   - If `REDIS_URL` is empty, run in single-node mode using in-memory channels.
   - If Redis becomes unreachable, log structured alert and degrade to local in-memory operation without crashing the Go process.

## IMPLEMENTATION RULES
- Always pass a bounded context (`context.WithTimeout(ctx, 500*time.Millisecond)`) to Redis operations.
- Never write large room snapshot blobs to Redis keys.
- Never execute Redis network commands while holding Go state mutexes.

## FAILURE CASES
- **Redis Crash**: Circuit breaker trips; Go server logs `slog.Error("redis unavailable, operating in degraded mode")` and continues serving local clients. Reconnects automatically with backoff.
- **Heartbeat Expiration**: If a participant drops, the 15s TTL reaps their presence key automatically.

## TEST REQUIREMENTS
- Test presence key auto-expiration after 15 seconds.
- Multi-instance test: verify messages published from Instance 1 reach Instance 2 and discard loopbacks.
- Degraded mode test: verify Go backend continues operating when Redis is killed.

## DO NOT
- DO NOT store permanent user, message, or room records in Redis.
- DO NOT use unbounded keys without TTLs.
- DO NOT execute Redis Pub/Sub commands inside Go mutex critical sections.
- DO NOT rely on Redis Pub/Sub for event replay after client reconnection.

## DONE WHEN
- Cross-instance room events route cleanly via Redis Pub/Sub.
- Re-broadcast loops are 100% prevented by instance ID checks.
- Backend degrades to local in-memory mode seamlessly if Redis drops.
