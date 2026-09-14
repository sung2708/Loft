# Skill: WebSocket Transport & Connection Lifecycle

## Trigger
Use this skill whenever modifying WebSocket connection handshakes, read/write pumps, heartbeat deadlines, connection tracking, backpressure management, or socket termination logic.

## Goals
- Maintain robust, leak-free WebSocket connection lifecycles.
- Enforce bounded outbound buffers (`make(chan []byte, 256)`) and non-blocking broadcasts.
- Protect the server from slow or uncooperative consumers without degrading room performance.

## Required reading
- [realtime-architecture.md](file:///d:/git/Loft/docs/realtime-architecture.md)
- [concurrency.md](file:///d:/git/Loft/docs/concurrency.md)
- [security.md](file:///d:/git/Loft/docs/security.md)

## Source of truth
- Connection state resides in `ClientConnection` struct within `internal/realtime/client.go`.

## Invariants
- Each WebSocket connection has exactly one `readPump` and one `writePump` goroutine.
- Outbound channel writes must **never block** the broadcaster; use non-blocking `select` with drop prioritization.
- Read deadline: 60s; Write deadline: 10s; Ping period: 25s.
- Origin header must be validated against `ALLOWED_ORIGIN` during HTTP upgrade.

## Workflow
1. Inspect connection handshake in `internal/realtime/hub.go`.
2. Ensure `readPump` sets `SetReadLimit(65536)` and configures pong handler to extend read deadline.
3. Ensure `writePump` writes sequentially from `sendChan` and flushes with write deadline.
4. Implement cleanup inside deferred block:
   ```go
   defer func() {
       c.hub.Unregister(c)
       c.conn.Close()
   }()
   ```
5. Test with slow client simulation.

## Implementation rules
- **WHAT TO DO:** Use non-blocking `select` when queueing messages to `sendChan`.
- **WHAT NOT TO DO:** Never write directly to `conn.WriteMessage` from arbitrary goroutines.
- **WHY:** Concurrent writes corrupt WebSocket framing and panic the runtime.
- **HOW TO VERIFY IT:** Run `go test -race ./internal/realtime/...`.

## Failure cases
- If outbound channel saturates for >5 seconds, terminate connection with close code `1008 (Policy Violation)`.
- If ping receives no pong within 60s, reap connection cleanly.

## Security considerations
- Reject upgrade requests with missing or untrusted `Origin` header (prevents CSWSH).
- Enforce IP-based rate limiting on WebSocket upgrades (max 10 handshakes/min per IP).

## Testing
- Test rapid connect/disconnect bursts.
- Simulate slow consumer by reading 1 byte/sec and assert socket is terminated after buffer overflow.

## Verification
- Connection teardown decrements `websocket_connections_active` metric and frees all goroutines.

## Common mistakes
- Closing `sendChan` from the sender while writer is still active, causing a panic on write.
- Forgetting to cancel connection context upon read error.

## Completion report
Upon finishing changes, summarize:
1. Lifecycle changes in `readPump` / `writePump`.
2. Buffer capacities and backpressure policy enforced.
3. Race detector test results.
