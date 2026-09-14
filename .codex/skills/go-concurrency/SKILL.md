# Skill: Go Concurrency, Thread Safety & Synchronization

## WHEN TO USE THIS SKILL
Use this skill whenever spawning goroutines, introducing channels, acquiring mutexes, structuring worker loops, or modifying concurrency-sensitive code in the Go backend.

## SOURCE OF TRUTH
- **In-Memory Room State**: Protected by `Hub.mu (sync.RWMutex)` and `roomState` pointers.
- **Outbound Socket Buffer**: Protected by dedicated client `writePump` and bounded channel `send`.

## ARCHITECTURAL BOUNDARIES
- Critical sections are pure RAM mutations ($<50\mu\text{s}$).
- Network I/O, database queries, Redis calls, and socket writes are **strictly prohibited** inside mutex critical sections.
- Bounded channels only (`outboundCapacity = 64`). Every goroutine must have an explicit owner and context.

## REQUIRED WORKFLOW
1. **The Concurrency Checklist**:
   - What state is shared?
   - What synchronization protects it?
   - Does any network/DB I/O occur inside the critical section? (**MUST BE NO**)
   - How does the goroutine terminate? (Listens to `ctx.Done()`)
   - Is all buffering bounded?
2. **Execute Critical Section**:
   - Acquire `mu.Lock()` or `mu.RLock()`.
   - Perform sub-microsecond in-memory updates or reads.
   - Extract state copies by value.
   - Release lock via `mu.Unlock()` or `mu.RUnlock()`.
3. **Dispatch Outside Lock**:
   - Execute JSON marshaling, database inserts, and room broadcasts **after** releasing the lock.
4. **Non-Blocking Channel Send**:
   - Always use `select { case ch <- msg: default: ... }`.
   - For saturated clients, call `c.conn.CloseNow()` immediately to prevent head-of-line blocking.
5. **Clean Teardown with WaitGroups**:
   - Supervise background pumps using `sync.WaitGroup`.
   - Cancel context on exit and wait for pumps to terminate before returning.

## IMPLEMENTATION RULES
- Always check and pass `-race`: `go test -race ./...`.
- Never use unbounded channels (`make(chan T)`).
- Never spawn detached fire-and-forget goroutines (`go func() { ... }()`) without tracking.

## FAILURE CASES
- **Slow Consumer**: If a client's 64-capacity outbound buffer fills, drop the client with `conn.CloseNow()`. Fast clients must not suffer broadcast latency spikes.
- **Context Cancellation**: Goroutines listening on `ctx.Done()` must exit promptly and free allocated resources.

## TEST REQUIREMENTS
- Parallel stress tests spawning 50 concurrent goroutines executing mutations against the hub.
- Assert goroutine counts return to baseline after connection teardown.

## DO NOT
- DO NOT perform SQL queries, Redis calls, or HTTP requests under mutex locks.
- DO NOT allow concurrent socket writers on the same WebSocket connection.
- DO NOT ignore race detector warnings during testing.

## DONE WHEN
- Critical sections hold locks only for in-memory pointer/counter mutations.
- `go test -race ./...` passes with zero race warnings.
- All goroutines terminate cleanly on context cancellation.
