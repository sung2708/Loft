# Testing Strategy & Chaos Verification — Loft

## 1. The Realtime Testing Pyramid

Testing a realtime distributed system requires verifying that state transitions remain sound under concurrent load, network drops, and corrupted payloads.

```
                  / \
                 / E2E\           (5% - Full Handshake & Resync Flow)
                /------\
               /  Race  \         (15% - `go test -race ./...` under concurrency)
              /----------\
             / Integration\       (30% - PostgreSQL & Redis with real containers)
            /--------------\
           /   Unit Tests   \     (50% - Math, Permissions, Codecs, State Machines)
          /------------------\
```

---

## 2. Unit Testing Strategy

Unit tests must execute in milliseconds without external network dependencies.
- **Domain Permission Testing:** Test all permutations of `CanKick`, `CanBan`, `CanControlMedia`, and `CanShareScreen` for every role (Host, Moderator, Member, Guest).
- **Media Position Math:** Test `base_position_ms + (now - started_at)` across edge cases (paused status, zero base position, negative drift).
- **Protocol Envelopes & Codecs:** Validate that malformed JSON, oversized payloads (>64KB), and unsupported protocol versions return clean errors rather than panics.
- **SSRF URL Parser:** Verify regex extraction against various YouTube, Spotify, and SoundCloud URL variants, plus adversarial inputs (`http://169.254.169.254/latest/meta-data`).

---

## 3. Concurrency & Race-Sensitive Testing

Concurrency bugs are release-blocking. All concurrent components are verified using Go's race detector:

```bash
go test -race -v -count=10 ./internal/...
```

### Mandatory Race Test Cases:
1. **Concurrent Media State Mutations:** 50 goroutines simultaneously issuing `MutateMedia` on the same `RoomActor`.
2. **Simultaneous Joins & Leaves:** Goroutines adding and removing subscribers from a room while messages are actively being broadcast.
3. **Slow Consumer Write Channel Saturation:** Simulating full outbound channels while the broadcaster pushes events.

---

## 4. Integration Testing with Real Containers

We do **not** mock the database or Redis in integration tests. We run tests against real PostgreSQL and Redis instances (e.g. via Docker Compose or `testcontainers-go`):

- **Migration Tests:** Verifies all sequential migration files apply cleanly forward and can rollback (`.down.sql`).
- **Database Transaction Guarantees:** Asserts that host transfer atomically updates both the `rooms` row and `room_memberships` rows.
- **Redis TTL Key Expiration:** Asserts that presence keys automatically disappear after their TTL expires.

---

## 5. Lightweight Chaos & Failure Injection

To ensure resilience, tests inject deterministic failures at subsystem boundaries:

| Injected Failure | Verification Criterion |
| :--- | :--- |
| **Postgres Query Timeout / Kill** | In-memory room operations continue; user receives clear `503` error when requesting history. |
| **Redis Connection Loss** | System logs degraded mode warning, falls back to local memory presence, and reconnects cleanly. |
| **Out-of-Order WS Events** | Event with `sequence < current_sequence` or stale `expected_version` is rejected with `ERROR_STALE_VERSION`. |
| **Duplicate Event Delivery** | Duplicate `queue.add` with identical `idempotency_key` returns the existing item without adding a duplicate. |
| **Sudden Socket Reset Mid-Command** | Server recovers goroutines cleanly without leaking channel memory. |

---

## 6. Continuous Integration (CI) Pipeline

GitHub Actions CI runs the following strict validation matrix on every PR:

```yaml
name: CI Pipeline
on: [push, pull_request]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: loft_test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      # Go Validation
      - name: Go Format & Vet
        run: |
          test -z $(gofmt -l .)
          go vet ./...
      - name: Go Race Tests
        run: go test -race -v ./...
        env:
          TEST_DATABASE_URL: postgres://postgres:test@localhost:5432/loft_test?sslmode=disable
          TEST_REDIS_URL: redis://localhost:6379

      # Frontend Validation
      - name: Frontend Typecheck & Lint
        working-directory: ./frontend
        run: |
          pnpm install --frozen-lockfile
          pnpm lint
          pnpm typecheck
          pnpm build
```
