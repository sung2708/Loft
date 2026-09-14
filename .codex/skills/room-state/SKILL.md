# Skill: Canonical Room State & Lifecycle Management

## Trigger
Use this skill whenever modifying the in-memory `RoomActor`, room versioning logic, membership rosters, snapshot serialization, host transfer, or host failover grace period timers.

## Goals
- Guarantee monotonic increment of `room.version` on authoritative mutations.
- Enforce race-safe host failover with deterministic successor election.
- Provide clean, complete `room.snapshot` generation for reconnecting clients.

## Required reading
- [room-state.md](file:///d:/git/Loft/docs/room-state.md)
- [reconnect-recovery.md](file:///d:/git/Loft/docs/reconnect-recovery.md)
- [concurrency.md](file:///d:/git/Loft/docs/concurrency.md)

## Source of truth
- In-memory active room authority belongs to the Go `RoomActor`.
- Durable metadata belongs to PostgreSQL `rooms` table.

## Invariants
- `room.version` increments by 1 on every state-changing mutation; it must never decrement or skip.
- Never perform database calls or network I/O while holding `RoomActor.mu`.
- Host failover must observe a 15-second grace period before triggering successor election.
- Successor election order is strictly deterministic: oldest active Moderator -> oldest active Member.

## Workflow
1. Locate target state mutation method in `internal/rooms/state.go`.
2. Acquire `r.mu.Lock()`.
3. Check preconditions and `expected_version` (if provided by client).
4. Apply in-memory mutation and increment `r.version++`.
5. Capture snapshot copy by value.
6. Release lock (`r.mu.Unlock()`).
7. Broadcast the corresponding typed event to subscribers outside the lock.
8. If mutation requires durability (e.g. host transfer), write to PostgreSQL asynchronously or via service transaction.

## Implementation rules
- **WHAT TO DO:** Return state copies by value from lock-protected methods.
- **WHAT NOT TO DO:** Never pass internal mutable state pointers outside the `RoomActor`.
- **WHY:** Exposing pointers allows callers to read or mutate state without holding the lock, causing silent data races.
- **HOW TO VERIFY IT:** Run `go test -race ./internal/rooms/...`.

## Failure cases
- If host disconnects, start a 15-second cancellation timer. If host reconnects within 15s, cancel timer. If timer fires, elect new host and persist to PostgreSQL.

## Security considerations
- Only authorized actors can trigger state mutations; verify permissions before acquiring the write lock.

## Testing
- Unit test monotonic version increments under rapid mutations.
- Test concurrent host reassignment commands to ensure only one succeeds.
- Test graceful eviction of empty rooms from memory after 10 minutes of inactivity.

## Verification
- Room state tests pass cleanly with `-race`.
- `room.snapshot` contains valid JSON matching `RoomSnapshotPayload`.

## Common mistakes
- Updating PostgreSQL while holding `RoomActor.mu.Lock()`, risking database pool deadlock.
- Reassigning host immediately upon transient socket close instead of waiting for the grace period.

## Completion report
Upon finishing changes, summarize:
1. State mutation and versioning behavior verified.
2. Grace period and failover timers validated.
3. Race detector test output.
