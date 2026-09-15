# Research: Host Lifecycle & Moderation

## Decision: Extend existing room authority and governance paths

**Rationale**: The repository already owns active room state in `backend/internal/realtime/hub.go`,
centralizes domain authorization in `backend/internal/domain`, persists governance state through
PostgreSQL, and propagates cross-instance events through Redis. A second moderation system would
violate the constitution and create split-brain authority.

**Alternatives considered**: A separate moderation service or frontend-owned host state was rejected
because both would weaken source-of-truth ownership and race safety.

## Decision: Preserve reconnect grace; distinguish intentional leave from transport loss

**Rationale**: Existing hub code already tracks connection grace timers and reconnect generations.
Host failover must build on those semantics so a refresh or brief network loss does not cause a
premature transfer.

**Alternatives considered**: Immediate failover on socket close was rejected because it conflicts
with existing reconnect recovery and can create duplicate hosts.

## Decision: Keep kick, temporary ban, lock, and host transfer as separate domain outcomes

**Rationale**: The existing system already distinguishes lock admission, kick persistence, and
participant leave events. Separate outcomes make retries, UI copy, and reconnect invalidation
testable without turning all moderation into a permanent ban.

**Alternatives considered**: Treating every kick as a permanent/global ban was rejected as unsafe,
overbroad, and incompatible with the requested social-room scope.

## Decision: Guest host eligibility remains an explicit planning decision

**Rationale**: Current identity semantics include authenticated users and room-scoped guests. The
plan must inspect the existing authority and security model before allowing a guest to become host.

**Alternatives considered**: Automatically allowing all guests was rejected because it could grant
durable governance power to a weakly identified session.

## Decision: Fresh snapshots remain the reconnect authority

**Rationale**: Existing protocol and constitution require snapshot recovery rather than unbounded
event replay. Host and moderation state must be represented in the snapshot whenever it affects
canonical room state.

**Alternatives considered**: Adding an unbounded moderation event history was rejected for memory,
reconnect, and multi-instance complexity.
