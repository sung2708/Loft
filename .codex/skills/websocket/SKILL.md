# Skill: WebSocket Transport & Connection Lifecycle

## WHEN TO USE THIS SKILL
Use this skill whenever modifying WebSocket connection handshakes, read/write pumps, backpressure management, heartbeat timers, socket admission limits, or connection teardown.

## SOURCE OF TRUTH
- **Connection Model**: `client` struct in `backend/internal/realtime/hub.go`.
- **Client Protocol Implementation**: `frontend/src/lib/realtime.ts` (`RoomSocket`).

## ARCHITECTURAL BOUNDARIES
- WebSocket connections are managed using `github.com/coder/websocket`.
- Bounded channels only (`outboundCapacity = 64`).
- Broadcast loops **never** block on socket I/O.
- The control plane carries JSON envelopes only; media tracks belong strictly in LiveKit.

## REQUIRED WORKFLOW
1. **HTTP Upgrade & Origin Validation**:
   - Check origin against `FRONTEND_ORIGINS`. Reject untrusted origins with `403 Forbidden`.
   - Apply connection rate limiter (`connectionLimit`).
   - Accept connection via `websocket.Accept(w, r, ...)`.
   - Set max read limit: `conn.SetReadLimit(maxEventBytes)` (16KB).
2. **Authentication Handshake**:
   - Set 8-second auth deadline. Read initial `connection.auth` envelope.
   - Verify Supabase JWT or guest HMAC token; load room state.
3. **Supervised Pumps**:
   - Instantiate `c.send` channel (capacity 64).
   - Spawn supervised `writePump` tracked by `sync.WaitGroup`.
   - Execute `readPump` synchronously inside HTTP handler.
4. **Clean Teardown**:
   - On exit, cancel handler context, invoke `conn.CloseNow()`, wait for pump waitgroup, and remove client from room state.
   - Broadcast `participant.left` to remaining peers.

## IMPLEMENTATION RULES
- **Non-blocking Broadcast**: Always deliver via `select { case c.send <- data: default: c.conn.CloseNow() }`.
- **Slow Consumer Policy**: Never buffer indefinitely. If a client's 64-frame buffer is saturated, terminate the socket immediately to isolate the rest of the room.
- **Lock Scope**: Never write to `conn.Write` while holding `Hub.mu` or state mutexes.

## FAILURE CASES
- **Saturated Socket**: Outbound buffer full → `CloseNow()` reaps the connection. Fast clients experience zero lag.
- **Idle Timeout**: If no incoming ping/data received within 60s, read pump returns error and cleans up.
- **Server Shutdown**: `Hub.Shutdown()` stops new joins, cancels active handlers, and waits for pumps before closing the database.

## TEST REQUIREMENTS
- Concurrency test: Run `go test -race ./internal/realtime/...`.
- Slow consumer test: Mock a paused client socket; verify it is dropped within 50ms without degrading broadcast to other clients.

## DO NOT
- DO NOT perform network I/O or socket writes while holding `Hub.mu`.
- DO NOT use unbounded channels (`make(chan []byte)`).
- DO NOT spawn detached fire-and-forget goroutines without waitgroup supervision.

## DONE WHEN
- Read and write pump lifecycles are context-bounded with zero dangling goroutines.
- Saturated slow clients are dropped cleanly without blocking room broadcasts.
- `go test -race ./internal/realtime/...` passes with zero data race warnings.
