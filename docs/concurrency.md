# Go Concurrency & Thread-Safety Architecture — Loft

## 1. Concurrency Philosophy: Explicit Ownership

In Loft, concurrency is designed around strict, predictable lifecycle boundaries:
1. **Every Goroutine Has an Owner:** No anonymous fire-and-forget goroutines (`go func() { ... }()`) are permitted unless tied to an explicit lifecycle context or waitgroup.
2. **Deterministic Termination:** Every goroutine must be guaranteed to terminate via context cancellation (`ctx.Done()`) or channel closure.
3. **No I/O Under Locks:** Mutexes protect pure in-memory state mutations only. Network I/O, database queries, Redis calls, and LiveKit HTTP requests are **strictly forbidden** inside critical sections.
4. **Race Detection is Release-Blocking:** Any data race detected by `go test -race ./...` blocks deployment.

---

## 2. Choosing Synchronization Primitives: Mutex vs. Channel

Developers often misuse Go channels as general-purpose state locks. Loft enforces clear usage criteria:

| Requirement | Preferred Primitive | Concrete Pattern |
| :--- | :--- | :--- |
| **Protecting Mutable Room State** | `sync.RWMutex` | Read-write locks inside `RoomActor` for sub-microsecond in-memory state checks and version bumps. |
| **Buffering Outbound Client Frames**| Bounded Channel (`chan []byte`) | Decouples the broadcaster from individual socket write speeds. |
| **Worker Fan-Out / Throttling** | Worker Pool + Semaphore | Limiting concurrent database batch writes or external webhook calls. |
| **Graceful Teardown Signaling** | `context.Context` / `chan struct{}` | Propagating cancellation from `main()` down to individual connection loops. |

---

## 3. The RoomActor Concurrency Pattern

```go
type RoomActor struct {
    mu          sync.RWMutex
    roomID      uuid.UUID
    version     uint64
    media       MediaPlaybackState
    queue       []QueueItem
    subscribers map[string]*ClientConnection // conn_id -> connection
    closing     chan struct{}
}

// MutateMedia executes pure in-memory mutation without I/O
func (r *RoomActor) MutateMedia(command MediaCommand) (MediaPlaybackState, error) {
    r.mu.Lock()
    defer r.mu.Unlock()

    // 1. Stale command check
    if command.ExpectedVersion != r.version {
        return MediaPlaybackState{}, ErrStaleVersion
    }

    // 2. State transition
    r.media.PlaybackStatus = command.Status
    r.media.BasePositionMs = command.PositionMs
    r.media.StartedAtServerTime = time.Now()
    r.version++ // Monotonic bump

    return r.media, nil
}
```

### Notice What is NOT Inside the Lock
- The resulting event is **not** marshaled to JSON inside the lock.
- The outbound broadcast is **not** written to client channels inside the lock.
- The state snapshot is returned by value to the caller, and the lock is released immediately.

---

## 4. Bounded Goroutines & Worker Pools

### Batch Chat Persistence Worker
Instead of spawning a new goroutine or executing a SQL insert for every single incoming chat message, a background worker batches messages:

```go
type ChatBatcher struct {
    inbox    chan *ChatMessage // Bounded (1024 capacity)
    db       *pgxpool.Pool
    ctx      context.Context
    cancel   context.CancelFunc
    wg       sync.WaitGroup
}

func (b *ChatBatcher) Start() {
    b.wg.Add(1)
    go func() {
        defer b.wg.Done()
        ticker := time.NewTicker(2 * time.Second)
        defer ticker.Stop()

        var batch []*ChatMessage

        for {
            select {
            case <-b.ctx.Done():
                // Flush remaining messages before exit
                b.flush(batch)
                return
            case msg := <-b.inbox:
                batch = append(batch, msg)
                if len(batch) >= 100 {
                    b.flush(batch)
                    batch = nil
                }
            case <-ticker.C:
                if len(batch) > 0 {
                    b.flush(batch)
                    batch = nil
                }
            }
        }
    }()
}
```

---

## 5. Concurrency Checklist for PR Review

Before merging any concurrency-sensitive code, verify:
- [ ] Does every spawned goroutine exit cleanly when `ctx.Done()` fires?
- [ ] Are all channels bounded with explicit buffer capacities?
- [ ] Is there any `select` without a default case that could block indefinitely?
- [ ] Are all struct pointers passed to goroutines either immutable or protected by synchronization?
- [ ] Has `go test -race ./...` been executed across all unit and integration test suites?
- [ ] Are locks acquired in a consistent hierarchical order across the codebase?
