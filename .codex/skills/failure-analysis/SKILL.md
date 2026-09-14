# Skill: Failure Analysis & Resilience Modeling

## WHEN TO USE THIS SKILL
Use this skill before designing, implementing, or refactoring critical workflows (room creation, joins, host disconnect, media state transitions, camera effects, WebSocket reconnection) to model failure points and recovery paths.

## SOURCE OF TRUTH
- **Resilience Matrix**: [failure-modes.md](file:///d:/git/Loft/docs/failure-modes.md).
- **Boundary Rules**: [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md).

## ARCHITECTURAL BOUNDARIES
- Subsystems fail independently: LiveKit failure does not bring down WebSocket control; Redis failure does not corrupt PostgreSQL.
- Degradation is graceful: Capabilities degrade (e.g. video effects disable, rate limits become local) rather than crashing the process.
- No cross-subsystem distributed transactions (2PC). Use transactional PostgreSQL for durability and ephemeral TTLs for coordination.

## REQUIRED WORKFLOW
1. **Model the Boundary Failure Protocol**:
   - What if PostgreSQL is unreachable? (Return friendly error; RAM state continues).
   - What if Redis Pub/Sub fails? (Fall back to local in-memory fan-out; do not crash).
   - What if LiveKit SFU is down? (Text chat and YouTube co-watching continue; show reconnecting badge on video dock).
   - What if client disconnects mid-mutation? (State version is already incremented; reconnecting client fetches fresh snapshot).
   - What if client vision filter throws an error? (Circuit breaker disables effect; raw camera stream continues).
2. **Apply Bounded Timeouts**:
   - Every external call must use `context.WithTimeout` ($<500\text{ms}$ for Redis, $<5\text{s}$ for DB queries).
3. **Log Contextual Warnings**:
   - Log failures with structured `slog` fields without leaking user credentials.
4. **Implement Automatic Recovery**:
   - Use exponential backoff with jitter on reconnections.

## IMPLEMENTATION RULES
- **Graceful Local Fallback**: Design the Go backend to operate with zero Redis dependency when needed.
- **Never Panic**: Catch panics at the HTTP and WebSocket handler boundaries using middleware.
- **Zero Cascading Crashes**: A slow or failing client must never degrade other participants in the room.

## FAILURE CASES
- **Database Down**: Reject new room creation and chat insertion with clear user feedback; keep active in-memory rooms running.
- **WASM Filter Exception**: Step down to raw camera stream without remounting the React tree.

## TEST REQUIREMENTS
- Simulate PostgreSQL connection timeout; verify server returns HTTP 503 without panic.
- Kill Redis container; verify multi-instance hubs degrade to local mode cleanly.
- Simulate slow client; verify `CloseNow()` drops the socket in $<50\text{ms}$.

## DO NOT
- DO NOT allow an external dependency outage (Redis, LiveKit) to panic or crash the Go backend.
- DO NOT execute infinite retries without exponential backoff.
- DO NOT assume atomic operations across PostgreSQL and Redis.

## DONE WHEN
- Workflow has explicit failure recovery for every external boundary.
- Process does not crash under simulated dependency failure.
- User receives actionable, friendly feedback when degraded.
