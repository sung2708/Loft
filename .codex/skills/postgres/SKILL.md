# Skill: PostgreSQL & Relational Persistence

## Trigger
Use this skill whenever writing SQL migrations, adding or altering tables, modifying `pgxpool` queries, defining transactions, or optimizing indexes in PostgreSQL.

## Goals
- Maintain durable relational data integrity.
- Enforce parameterized queries to eliminate SQL injection.
- Ensure all multi-table mutations execute within atomic transactions.
- Prevent ephemeral presence and high-frequency scrub positions from polluting PostgreSQL.

## Required reading
- [database.md](file:///d:/git/Loft/docs/database.md)
- [concurrency.md](file:///d:/git/Loft/docs/concurrency.md)
- [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md)

## Source of truth
- Durable data (Users, Profiles, Rooms, Memberships, Messages, Bans, Invites) belongs to PostgreSQL.

## Invariants
- Schema modifications must be written as sequential, forward-only migration files (`00000X_name.up.sql` and `00000X_name.down.sql`).
- All queries must use parameterized placeholders (`$1, $2`).
- **CRITICAL INVARIANT:** Never perform network I/O (LiveKit, Redis, WebSocket) while holding an open database transaction.
- Every non-trivial index must be justified by a documented query access pattern.

## Workflow
1. Write the new migration files in `backend/migrations/`.
2. Apply migration using test container or local PostgreSQL.
3. Write repository methods in `internal/<domain>/repository.go` using `pgxpool.Pool`.
4. Wrap multi-table operations (e.g. host transfer + role updates) inside `pgx.Tx`.
5. Execute `EXPLAIN ANALYZE` on new queries to verify index usage.

## Implementation rules
- **WHAT TO DO:** Use `pgx.BeginTx(ctx, pgx.TxOptions{})` and ensure `defer tx.Rollback(ctx)` is called.
- **WHAT NOT TO DO:** Never use dynamic string formatting (`fmt.Sprintf("SELECT * FROM ... WHERE id = '%s'", id)`).
- **WHY:** String concatenation creates severe SQL injection vulnerabilities.
- **HOW TO VERIFY IT:** Run static analysis checks and test query parameterization.

## Failure cases
- If a transaction conflicts or encounters a deadlock, roll back cleanly and return a structured domain error (`409 Conflict`).

## Security considerations
- Enforce foreign keys with `ON DELETE CASCADE` or `RESTRICT` appropriately.
- Ensure sensitive tables (e.g. `room_bans`) are only mutated by authorized repository methods.

## Testing
- Test migrations by running both up and down migrations on a test database.
- Test transaction rollbacks: simulate error halfway through host transfer and assert no partial records remain.

## Verification
- Migrations apply with zero errors.
- Integration tests pass against real PostgreSQL container.

## Common mistakes
- Forgetting to call `tx.Commit(ctx)`, causing transactions to roll back silently upon defer.
- Creating indexes on low-cardinality columns without justification.

## Completion report
Upon finishing changes, summarize:
1. Migration files created.
2. Repository methods and queries added.
3. Transaction boundaries and rollback safety.
4. Indexes added with target query justification.
