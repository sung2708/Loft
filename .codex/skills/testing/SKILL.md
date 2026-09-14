# Skill: Testing Methodology & Test Suite Maintenance

## Trigger
Use this skill whenever writing unit tests, integration tests, race detection tests, protocol codecs, or mock fixtures across the backend or frontend.

## Goals
- Enforce the testing pyramid (50% unit, 30% integration, 15% race, 5% E2E).
- Ensure all concurrent Go code is validated with `go test -race ./...`.
- Test real database transactions and Redis TTLs against containerized dependencies.

## Required reading
- [testing-strategy.md](file:///d:/git/Loft/docs/testing-strategy.md)
- [failure-modes.md](file:///d:/git/Loft/docs/failure-modes.md)

## Source of truth
- Test suites in `backend/**/*_test.go` and `frontend/src/**/*.test.ts`.

## Invariants
- Tests must be deterministic: zero `time.Sleep()` based assertions; use synchronization primitives, channels, or polling helpers with deadlines.
- Every state mutation method in `RoomActor` must have a corresponding race test with at least 20 concurrent goroutines.
- Unit tests must not require running external infrastructure.
- Race detector failures are release-blocking.

## Workflow
1. Write table-driven unit tests for domain logic and math.
2. For repository tests: connect to test PostgreSQL instance and execute migrations.
3. For realtime tests: use `net/http/httptest` with websocket client to test handshake, auth, and snapshots.
4. Run `go test -race -v -count=1 ./...`.
5. Run frontend tests: `npm run test`.

## Implementation rules
- **WHAT TO DO:** Use `t.Parallel()` for independent unit tests to speed up CI runs.
- **WHAT NOT TO DO:** Never use arbitrary `time.Sleep(500 * time.Millisecond)` to wait for asynchronous events.
- **WHY:** Arbitrary sleeps cause flaky tests on slow CI machines and waste developer time.
- **HOW TO VERIFY IT:** Assert tests pass repeatedly with `-count=10`.

## Failure cases
- If a test fails intermittently under `-race`, identify the unprotected struct field or channel read immediately.

## Security considerations
- Never check in production credentials or secrets inside test fixtures.

## Testing
- Run full suite: `go test -race ./... && npm test`.

## Verification
- 100% test pass rate with zero race detector warnings.

## Common mistakes
- Mocking `pgxpool.Pool` with giant mock frameworks instead of testing against a real local PostgreSQL test database.

## Completion report
Upon finishing changes, summarize:
1. Test files added or modified.
2. Race test execution results.
3. Integration and unit test coverage.
