# Skill: Code Review & Anti-Pattern Hunting

## Trigger
Use this skill whenever reviewing code, performing self-review before committing, analyzing pull requests, or refactoring existing modules in Loft.

## Goals
- Enforce strict adherence to the 13-stage review hierarchy.
- Proactively detect and eliminate concurrency races, memory leaks, security holes, and backpressure bugs.
- Guarantee that all invariants defined in `AGENTS.md` and `docs/` are respected.

## Required reading
- [AGENTS.md](file:///d:/git/Loft/AGENTS.md)
- [security.md](file:///d:/git/Loft/docs/security.md)
- [concurrency.md](file:///d:/git/Loft/docs/concurrency.md)
- [failure-modes.md](file:///d:/git/Loft/docs/failure-modes.md)

## Source of truth
- Architecture guidelines and invariant contracts across `docs/`.

## Invariants (Strict 13-Stage Review Order)
Reviews must proceed in this exact priority sequence; style never trumps correctness:
1. **Correctness:** Does the code solve the concrete problem without edge-case regressions?
2. **Security:** Zero-trust client boundaries, JWT validation, origin check, SSRF guards.
3. **Authorization:** Centralized permission checks (`CanKick`), zero client-trusted roles.
4. **Data Integrity:** PostgreSQL as durable truth, atomic transactions, no permanent Redis truth.
5. **Concurrency:** No races, no I/O under locks, bounded channels, explicit goroutine lifecycles.
6. **Realtime Semantics:** Typed protocol, monotonic versions, slow consumer drop policy.
7. **Failure Handling:** External calls have timeouts, graceful degradation, reconnect recovery.
8. **Resource Cleanup:** Context cancellation, closed channels, freed database connections.
9. **Backwards Compatibility:** Protocol schema evolution, versioned envelopes.
10. **Observability:** Structured JSON logs, correlation IDs, no high-cardinality metric labels.
11. **Performance:** Efficient memory use, no N+1 queries, non-blocking broadcasts.
12. **Maintainability:** Clear package ownership, minimal abstractions, readable Go idioms.
13. **Style:** Clean formatting, idiomatic naming, zero redundant comments.

---

## Specific Anti-Pattern Checklist (The Bug Hunt)

Actively audit code for these specific flaws:
- [ ] **Goroutine Leaks:** Any `go func()` lacking `ctx.Done()` or WaitGroup tracking?
- [ ] **I/O Under Locks:** Any `db.Query`, `redis.Do`, `http.Get`, or `ws.Write` while holding a mutex?
- [ ] **Unbounded Buffers:** Any `make(chan T)` without explicit capacity?
- [ ] **Broadcaster Blocking:** Any channel write that can hang if a single client is slow?
- [ ] **Client-Trusted Identity:** Any handler reading `user_id` or `role` from an untrusted JSON body?
- [ ] **Ad-hoc Role Checks:** Any `if role == "host"` scattered in transport code?
- [ ] **SSRF Vulnerability:** Any media URL fetched without domain whitelist and IP blocklist checks?
- [ ] **CSWSH Vulnerability:** Any WebSocket upgrade omitting strict `Origin` header verification?
- [ ] **Silent Error Swallowing:** Any `_ = err` or empty `if err != nil {}` blocks?
- [ ] **Metric Cardinality Explosion:** Any Prometheus labels using UUIDs (`room_id`, `user_id`)?
- [ ] **Redis as Permanent Database:** Any critical state stored in Redis without PostgreSQL durability?
- [ ] **Missing Transaction Boundaries:** Multi-row mutations (e.g. host transfer) executed without `BEGIN ... COMMIT`?

---

## Workflow
1. Execute `git diff` to inspect changes.
2. Step through the 13 review stages sequentially.
3. Check code against the Anti-Pattern Checklist.
4. Run `go test -race ./...` and verify clean execution.
5. Compile structured review feedback or refactor findings.

## Verification
- Code passes all 13 review stages without blocking defects.
- All detected anti-patterns are remediated before merging.

## Completion report
Upon finishing review, summarize:
1. Review stages audited.
2. Anti-patterns hunted and findings.
3. Verification commands executed (`go test -race`, `golangci-lint`).
