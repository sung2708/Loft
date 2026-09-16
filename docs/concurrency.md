# Concurrency, Thread Safety & Backpressure — Mingly

This document specifies the concurrency principles, channel buffering, backpressure policies, and locking scope rules for Mingly's Go backend.

---

## 1. Core Concurrency Invariants

Every technical change in the Go backend must adhere to these non-negotiable concurrency invariants:

1. **Every Goroutine Has an Explicit Owner**: Anonymous, detached goroutines (`go func() { ... }()`) are strictly forbidden. Every goroutine must be tracked by a `sync.WaitGroup` or managed by an explicit lifecycle context (`ctx.Done()`).
2. **Zero I/O Under Locks**: Mutexes (`sync.Mutex`, `sync.RWMutex`) protect pure in-memory state mutations only. Network I/O, database queries, Redis calls, and LiveKit HTTP requests are **strictly forbidden inside critical sections**.
3. **No Unbounded Channels or Buffers**: All Go channels must have explicit, bounded capacities. Unbounded channels risk out-of-memory crashes under load spikes.
4. **Race Detector is Mandatory**: All concurrency-sensitive backend tests must pass with `go test -race ./...`. Any pull request introducing a data race is release-blocking.

---

## 2. Bounded Queues & Backpressure

### Outbound Buffer Sizing (`outboundCapacity = 64`)
Each connected WebSocket client owns a bounded outbound channel:

```go
type client struct {
    id          string
    roomID      string
    conn        *websocket.Conn
    send        chan []byte // Bounded: cap 64
    // Token buckets for per-connection rate limiting
    chatTokens     chan struct{} // cap 5
    reactionTokens chan struct{} // cap 4
}
```

### The Slow Consumer Policy
In a realtime room, one slow or paused client (e.g. mobile device switching cell towers or browser tab throttled by the OS) must **never** block or delay event broadcasts to the rest of the room.

```go
func (h *Hub) broadcast(roomID string, data []byte, exclude string) {
    h.mu.RLock()
    state := h.rooms[roomID]
    clients := make([]*client, 0)
    if state != nil {
        for id, c := range state.clients {
            if id != exclude {
                clients = append(clients, c)
            }
        }
    }
    h.mu.RUnlock()

    for _, c := range clients {
        if !h.enqueue(c, data) {
            // A saturated peer may never acknowledge a graceful close frame.
            // Terminate connection immediately to protect the room loop.
            _ = c.conn.CloseNow()
        }
    }
}

func (h *Hub) enqueue(c *client, data []byte) bool {
    select {
    case c.send <- data:
        return true
    default:
        return false // Buffer full: client is a slow consumer
    }
}
```

### Key Behaviors:
- **Non-blocking Enqueue**: Messages are delivered via `select ... case c.send <- data: default: return false`. The broadcast loop never waits for a socket write.
- **Immediate Socket Termination**: If `c.send` is full (64 buffered frames pending), the server calls `c.conn.CloseNow()`. This immediately drops the TCP connection, aborts the write pump, frees allocated memory, and broadcasts `participant.left` to the room.

---

## 3. Lock Scopes & Critical Section Guidelines

```
   [ Incoming WS Message ]
              │
              ▼ (ReadPump: Outside Lock)
      1. Parse & Validate Envelope
      2. Check Rate Limits
              │
              ▼ (Acquire Lock: Hub.mu.Lock)
      3. In-Memory State Mutation
         - Mutate mediaState
         - Verify expected_version
         - Increment version++
         - Create snapshot copy
              │
              ▼ (Release Lock: Hub.mu.Unlock)
      4. Asynchronous / Non-Blocking Operations
         - Insert to PostgreSQL (if chat)
         - Broadcast snapshot to room clients
         - Publish to Redis Pub/Sub
```

### Invariant Table

| Operation | Permitted Inside Mutex? | Rationale |
| :--- | :---: | :--- |
| Inspecting / Updating `version` | **YES** | Sub-microsecond RAM access; preserves serializability. |
| Permuting `Queue` slice | **YES** | Pure in-memory pointer rearrangement ($<10\mu\text{s}$). |
| JSON Marshaling / Unmarshaling | **NO** | CPU-intensive; serialize outside the critical section. |
| Database Queries (`pgxpool`) | **NO** | Network latency ($1–10\text{ms}$) blocks concurrent room operations. |
| Redis Pub/Sub (`PUBLISH`) | **NO** | Network round-trip causes contention under high load. |
| WebSocket Socket Write (`conn.Write`) | **NO** | Network TCP backpressure would stall entire server process. |

---

## 4. Connection Lifecycle & Clean Teardown

```go
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithCancel(r.Context())
    defer cancel()

    // 1. WebSocket Upgrade
    conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{ ... })
    if err != nil { return }
    defer conn.CloseNow()

    // 2. Authenticate & Admit
    identity, room, err := h.authenticate(ctx, conn)
    if err != nil { return }

    c := &client{ ... }
    h.add(c, room)
    defer h.remove(c)

    // 3. Supervised Pumps
    var pumps sync.WaitGroup
    pumps.Add(1)
    go func() { defer pumps.Done(); _ = h.writePump(ctx, c) }()
    defer func() { cancel(); _ = conn.CloseNow(); pumps.Wait() }()

    // 4. Read pump blocks until disconnect
    _ = h.readPump(ctx, c)
}
```

- When the read pump exits (socket closed, EOF, or error), context cancellation terminates the write pump.
- `conn.CloseNow()` interrupts pending socket I/O instantly.
- `pumps.Wait()` guarantees zero dangling goroutines before `ServeHTTP` completes.
