# Skill: Go Concurrency & Synchronization

## Trigger
Use this skill whenever spawning goroutines, introducing channels, acquiring mutexes, managing worker pools, or modifying concurrency-sensitive code (e.g. `RoomActor`, pump loops, broadcast hubs).

## Goals
- Guarantee zero data races, zero goroutine leaks, and zero deadlocks.
- Ensure all channels are bounded and non-blocking under broadcast fan-out.
- Prevent network or database I/O while holding synchronization locks.

## Required reading
- [concurrency.md](file:///d:/git/Loft/docs/concurrency.md)
- [realtime-architecture.md](file:///d:/git/Loft/docs/realtime-architecture.md)

## Source of truth
- In-memory room state authority belongs to the specific `RoomActor` instance.

## Invariants (The Concurrency Questionnaire)
Before writing any concurrent code, answer these ten mandatory questions:
1. **What state is shared?** Identify the exact struct fields.
2. **Who owns it?** Specify the single struct or loop that coordinates access.
3. **What can mutate it?** Restrict mutation to designated actor methods.
4. **What synchronization protects it?** (`sync.RWMutex`, atomic value, or channel loop).
5. **Can network I/O happen while locked?** **NO.** Critical sections must be $< 50\mu s$.
6. **How does the goroutine terminate?** Listening on `ctx.Done()` or explicit quit channel.
7. **What happens on shutdown?** Graceful drain via `sync.WaitGroup`.
8. **Is buffering bounded?** Yes, all channels must have explicit non-zero capacity.
9. **What happens to slow consumers?** Ephemeral events dropped; persistently slow sockets closed with code 1008.
10. **How will this be race-tested?** `go test -race -count=10 ./...`.

## Workflow
1. Scope the critical section: copy necessary state by value or reference under lock.
2. Release lock **before** serializing to JSON, sending across channels, or writing to sockets.
3. If dispatching to a client channel, use non-blocking `select`:
   ```go
   select {
   case ch <- msg:
   default:
       // Handle slow consumer outside lock
   }
   ```
4. Verify goroutine lifecycle with `sync.WaitGroup` and `context.CancelFunc`.

## Implementation rules
- **WHAT TO DO:** Use `defer mu.Unlock()` immediately after `mu.Lock()`; use bounded channels (`make(chan []byte, 256)`).
- **WHAT NOT TO DO:** Never perform database, Redis, or LiveKit calls while holding a lock. Never create unbounded channels (`make(chan T)`).
- **WHY:** Blocking inside locks cascades into thread exhaustion and server-wide lockups.
- **HOW TO VERIFY IT:** Run `go test -race ./...`.

## Failure cases
- If a client stops consuming frames, the non-blocking send drops ephemeral messages and flags the connection for slow-consumer termination after 5 seconds of continuous saturation.

## Security considerations
- Saturated channels must not cause memory exhaustion (OOM); bounded buffers prevent DoS from slow clients.

## Testing
- Write parallel stress tests spawning 100 goroutines concurrently reading and mutating state.
- Assert that goroutine count returns to baseline after teardown (`runtime.NumGoroutine()`).

## Verification
- `go test -race -v -run TestConcurrent ./...` passes cleanly with 0 race warnings.

## Common mistakes
- Launching goroutines inside HTTP handlers without passing request context or tracking in a WaitGroup.
- Calling `conn.WriteMessage()` from multiple goroutines simultaneously (Gorilla/Coder WS does not allow concurrent writers; use dedicated `writePump`).

## Completion report
Upon finishing changes, summarize:
1. Shared state identified and synchronization mechanism chosen.
2. Goroutine termination condition and WaitGroup tracking.
3. Confirmation that no I/O occurs inside critical sections.
4. Output of `go test -race ./...`.
