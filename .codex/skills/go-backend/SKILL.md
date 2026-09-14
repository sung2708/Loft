# Skill: Go Backend Engineering

## Trigger
Use this skill whenever creating or modifying Go backend packages, HTTP handlers, middleware, services, or repository layers in the Loft modular monolith.

## Goals
- Maintain idiomatic, standard-library-first Go architecture.
- Enforce explicit dependency injection via constructors (`NewService(...)`).
- Guarantee clean error wrapping (`fmt.Errorf("...: %w", err)`), context propagation, and structured logging.

## Required reading
- [architecture.md](file:///d:/git/Loft/docs/architecture.md)
- [backend-plan.md](file:///d:/git/Loft/docs/backend-plan.md)
- [api-conventions.md](file:///d:/git/Loft/docs/api-conventions.md)

## Source of truth
- Business logic & service boundaries reside in Go `internal/<domain>/` packages.
- Durable relational state resides in PostgreSQL via `pgxpool`.

## Invariants
- No global mutable state or init-time singleton connections.
- No Java-style enterprise abstractions (e.g. generic `IRepository[T]` or reflection-based DI frameworks).
- Every handler must propagate `r.Context()`.
- Standard library idioms take precedence over third-party framework magic.

## Workflow
1. Define domain models and narrow consumer interfaces in the relevant `internal/<domain>` package.
2. Implement constructors accepting dependencies explicitly:
   ```go
   func NewService(db *pgxpool.Pool, logger *slog.Logger) *Service
   ```
3. Wire the service inside `cmd/server/main.go`.
4. Implement chi HTTP routes matching [api-conventions.md](file:///d:/git/Loft/docs/api-conventions.md).
5. Add unit tests and execute `go test -race ./...`.

## Implementation rules
- **WHAT TO DO:** Use `errors.Is()` and `errors.As()` for error inspection; return domain errors wrapped with context.
- **WHAT NOT TO DO:** Never use `panic` for normal error conditions; never swallow errors with `_ = err`.
- **WHY:** Panics crash server goroutines and blind monitoring systems; unhandled errors cause silent data corruption.
- **HOW TO VERIFY IT:** Run `go vet ./...` and `golangci-lint run`.

## Failure cases
- If a downstream dependency fails (e.g., PostgreSQL query timeout), return standardized JSON error using HTTP status 503 or 500, logging the internal error with request correlation ID.

## Security considerations
- Never log raw authorization tokens, passwords, or PII.
- Enforce parameterization on all SQL queries (`$1, $2`).

## Testing
- Write table-driven unit tests for service business logic.
- Mock external network calls by satisfying small interfaces; use real test databases for repository integration tests.

## Verification
- `go build ./cmd/server` succeeds without warnings.
- `go test -race ./internal/...` passes.

## Common mistakes
- Misplacing business validation in HTTP handlers instead of the domain service.
- Forgetting to propagate `ctx` down to database and Redis calls.

## Completion report
Upon finishing changes, summarize:
1. Packages and files modified.
2. Interface contracts added or updated.
3. Errors wrapped and logged.
4. Unit and race tests verified.
