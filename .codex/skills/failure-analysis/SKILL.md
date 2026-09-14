# Skill: Failure Analysis & Resilience Modeling

## Trigger
Use this skill before designing or implementing critical workflows such as room creation, joining, host failover, media queue transitions, ban enforcement, or WebSocket reconnection.

## Goals
- Identify failure points at every boundary before writing code.
- Prevent cascading failures, thread leaks, and partial database states.
- Ensure every critical operation has an explicit, tested recovery path.

## Required reading
- [failure-modes.md](file:///d:/git/Loft/docs/failure-modes.md)
- [reconnect-recovery.md](file:///d:/git/Loft/docs/reconnect-recovery.md)
- [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md)

## Source of truth
- Failure analysis matrix defined in [failure-modes.md](file:///d:/git/Loft/docs/failure-modes.md).

## Invariants
- No operation may leave the system in an inconsistent or undefined state upon partial failure.
- Every external dependency call (PostgreSQL, Redis, LiveKit, Network) must be treated as potentially failing, hanging, or timing out.

## Workflow: The Boundary Failure Protocol
Before writing implementation code for a critical workflow:
1. **Document Happy Path:** Step-by-step sequence when all systems succeed.
2. **Inject External Boundary Failures:**
   - What if PostgreSQL succeeds, but Redis Pub/Sub fails?
   - What if Go succeeds, but LiveKit token verification fails?
   - What if client disconnects while the server is processing the command?
   - What if the Go process dies immediately after committing the database transaction?
   - What if the client retries the identical request twice?
3. **Define Recovery Action for Each:**
   - Rollback transaction?
   - Rely on TTL expiration?
   - Return idempotent cached response?
   - Mark state degraded?
4. Implement the recovery logic and add deterministic failure tests.

## Implementation rules
- **WHAT TO DO:** Set bounded timeouts (`context.WithTimeout`) on all external boundary calls.
- **WHAT NOT TO DO:** Never write infinite retries without exponential backoff and max retry limits.
- **WHY:** Infinite retries create thundering herd storms that prevent recovering services from booting.
- **HOW TO VERIFY IT:** Execute boundary failure integration tests.

## Failure cases
- If LiveKit token issuance fails during room join, the client is notified via `system.error (MEDIA_UNAVAILABLE)` and can still participate in text chat and media watching.

## Security considerations
- Ensure that failure handling does not bypass authorization or leak sensitive error details to clients.

## Testing
- Inject simulated timeouts on database queries using mock or delayed network wrappers.
- Verify that transient network loss recovers via `room.snapshot` without duplicate records.

## Verification
- Workflow passes failure injection test suite cleanly.

## Common mistakes
- Assuming an operation is atomic across PostgreSQL, Redis, and LiveKit without implementing compensating actions.

## Completion report
Upon finishing changes, summarize:
1. Critical workflow mapped across subsystems.
2. Failure cases analyzed at each boundary.
3. Compensating and recovery actions verified in tests.
