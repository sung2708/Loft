# Realtime Architecture & WebSocket Engineering — Mingly

## 1. WebSocket Connection Lifecycle Architecture

The WebSocket server provides bidirectional communication for control plane events, chat, presence, and synchronized media. It never transports raw audio, video, or screen sharing streams.

```
       Client                             Go WebSocket Hub
         │                                       │
         ├────── HTTP Upgrade (GET /ws) ────────►│ (Check Origin & Rate Limit)
         │◄───── 101 Switching Protocols ────────┤ (Set Read/Write Deadlines)
         │                                       │
         ├────── connection.auth ───────────────►│ (Verify Supabase JWT / Guest HMAC)
         │◄───── connection.authenticated ───────┤ (Spawn Read & Write Pumps)
         │                                       │
         ├────── room.join {room_id} ───────────►│ (Validate Membership & Ban status)
         │◄───── room.snapshot {version: 42} ────┤ (Register in Room Hub)
         │                                       │
   ┌─────┴───────────────────────────────────────┴─────┐
   │             STEADY STATE (Pump Loops)             │
   │  - Client sends ping every 25s                    │
   │  - Server sets read deadline: 60s                 │
   │  - Server broadcasts bounded events via channel   │
   │  - Slow consumers handled via backpressure engine │
   └─────┬───────────────────────────────────────┬─────┘
         │                                       │
         ├────── Clean Disconnect / Loss ────────┤
         ▼                                       ▼ (Unregister, update presence,
                                                    start host failover timer if host)
```

---

## 2. Goroutine Ownership & Lifecycle Model

For every active WebSocket connection, exactly **two goroutines** are spawned:

1. **`readPump` (Owner of socket read stream):**
   - Sets maximum payload read limit (`MaxMessageSize = 64 * 1024` bytes).
   - Enforces read deadline (`SetReadDeadline(now + 60s)` extended on every incoming Pong).
   - Deserializes envelopes, parses typed payloads, executes authorization checks, and dispatches events to the target `RoomActor`.
   - **Termination Condition:** Read error, context cancellation, or socket EOF. Upon termination, it triggers connection teardown.

2. **`writePump` (Owner of socket write stream):**
   - Listens on `conn.sendChan` (a bounded channel of `[]byte`, capacity: `256`).
   - Enforces write deadline (`SetWriteDeadline(now + 10s)` per message write).
   - Writes frames sequentially to the underlying socket.
   - **Termination Condition:** Read error notification, `conn.sendChan` closure, or shutdown signal.

```go
type ClientConnection struct {
    ID          string
    UserID      uuid.UUID
    RoomID      uuid.UUID
    Conn        *websocket.Conn
    sendChan    chan []byte       // Bounded buffer (256 items)
    hub         *RoomHub
    cancelFunc  context.CancelFunc
    isSlow      atomic.Bool
}
```

---

## 3. Backpressure & Slow-Consumer Policy

In a realtime room, one user with an unstable 3G connection or blocked tab must **never** degrade the broadcast performance or increase latency for other participants.

### The Non-Blocking Broadcast Invariant
Broadcasting to room participants never performs blocking channel writes (`sendChan <- msg`). Instead, a non-blocking `select` with drop prioritization is used:

```go
func (c *ClientConnection) QueueEvent(envelope []byte, isEphemeral bool) bool {
    select {
    case c.sendChan <- envelope:
        return true
    default:
        // Buffer is full (256 pending messages)
        if isEphemeral {
            // Drop ephemeral packets (e.g. reactions, non-critical typing indicators)
            metrics.DroppedEphemeralEventsTotal.Inc()
            return false
        }

        // Critical message cannot be delivered (e.g. room state mutation, moderation)
        // Mark client as slow consumer
        if c.isSlow.CompareAndSwap(false, true) {
            go c.handleSlowConsumer()
        }
        return false
    }
}
```

### Slow Consumer Termination Strategy
1. If a client’s buffer remains saturated for more than `5 seconds`, or drops more than `50` critical events:
2. The server forcefully terminates the connection using WebSocket close code `1008 (Policy Violation)`.
3. The client transitions to `RECONNECTING` and recovers authoritative state via `room.snapshot`.
4. This guarantees memory stability and prevents goroutine pileups.

---

## 4. Connection Safety & Constraints

| Parameter | Configuration | Rationale |
| :--- | :--- | :--- |
| **Max Payload Size** | 64 KB (`65,536` bytes) | Prevents memory exhaustion attacks via oversized chat messages. |
| **Ping Interval** | 25 Seconds | Keeps NAT bindings and stateful firewalls alive. |
| **Pong Read Deadline**| 60 Seconds | Allows 2 missed pings before cleanly reaping dead connections. |
| **Send Buffer Depth** | 256 Envelopes | Sufficient for bursty chat/reactions without consuming excessive RAM per client. |
| **Origin Verification**| Strict Whitelist | Rejects WebSocket connection requests from unauthorized third-party origins (CSWSH prevention). |

---

## 5. Graceful Teardown & Disconnect Cleanup

When a connection terminates:
1. `readPump` detects EOF or socket error and calls `cancelFunc()`.
2. Unregisters from `RoomActor` and `RoomHub`.
3. If the user has no remaining active connections to the room:
   - Sets a disconnect marker in Redis presence.
   - If the disconnecting user was the **Room Host**, the server starts the **Host Failover Grace Period (15s)**.
4. Outbound channel is drained and closed safely.
