# Skill: Distributed Systems & State Coordination

## Trigger
Use this skill whenever modifying multi-instance coordination, cross-node broadcasting, cluster state reconciliation, distributed lock leases, or node partition recovery.

## Goals
- Guarantee state convergence across multi-instance deployments.
- Prevent distributed split-brain conditions during host failover or node crashes.
- Never use hand-waving phrases like "eventually consistent" without specifying concrete reconciliation mechanics.

## Required reading
- [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md)
- [room-state.md](file:///d:/git/Loft/docs/room-state.md)
- [redis.md](file:///d:/git/Loft/docs/redis.md)
- [failure-modes.md](file:///d:/git/Loft/docs/failure-modes.md)

## Source of truth
- In-memory active authority is partitioned by `room_id`.
- Durable consensus authority resides in PostgreSQL.

## Invariants (The Distributed Systems Contract)
Before changing any distributed behavior, document:
1. **Authority:** Exactly which node or database row is authoritative for this mutation?
2. **Consistency Requirement:** Is linearizability required (e.g. host election) or monotonic causal ordering (e.g. chat)?
3. **Ordering:** What assigns sequence numbers? (`RoomActor.version`).
4. **Delivery Semantics:** At-least-once, at-most-once (e.g. reactions), or idempotent deduplication?
5. **Retry Behavior:** What backoff and jitter governs client retries?
6. **Idempotency:** What key prevents duplicate application? (`idempotency_key` / `event_id`).
7. **Partition Behavior:** What happens if Redis or network between nodes splits?
8. **Recovery:** How does a lagging node catch up? (Authoritative `room.snapshot`).
9. **Reconciliation:** What resolves concurrent conflicting writes? (Optimistic version check).

## Workflow
1. Identify if operation requires durable consensus or ephemeral coordination.
2. For cluster-wide coordination (e.g. failover election), acquire distributed Redis lease with TTL (`SET NX EX 5`).
3. If lease acquired, execute atomic PostgreSQL transaction.
4. Broadcast state transition to cluster via Redis Pub/Sub.
5. Reconcile any connected clients using versioned snapshot comparison.

## Implementation rules
- **WHAT TO DO:** Use atomic conditional updates in PostgreSQL (`WHERE host_id = $old_host`).
- **WHAT NOT TO DO:** Never assume Redis Pub/Sub messages arrive in guaranteed order across multiple nodes.
- **WHY:** Network partitions or broker lag can reorder packets, causing stale states to overwrite newer states without version checks.
- **HOW TO VERIFY IT:** Run dual-node cluster integration tests.

## Failure cases
- If network partition occurs, each node continues serving local connections; cross-node broadcast resumes once partition heals. Reconnecting clients fetch fresh snapshots.

## Security considerations
- Validate that cross-instance messages on Redis Pub/Sub cannot be injected by unauthorized external entities.

## Testing
- Simulate concurrent host election from two simulated Go instances; verify exactly one wins.
- Test message deduplication with duplicate `event_id` submissions.

## Verification
- Dual-node cluster passes multi-client room sync tests.
- Zero split-brain or duplicate host assignments observed.

## Common mistakes
- Assuming two separate databases or Redis and Postgres form a distributed transaction (they do not; coordinate via saga or snapshot).

## Completion report
Upon finishing changes, summarize:
1. Distributed state authority and ordering model.
2. Partition and failure recovery strategy.
3. Cluster coordination test results.
