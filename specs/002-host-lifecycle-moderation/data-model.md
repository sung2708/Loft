# Data Model: Host Lifecycle & Moderation

## Durable Room Owner

- `room_id`: durable room identity.
- `owner_id`: authenticated durable owner.
- Existing access, lock, membership, and ban records remain authoritative for durable policy.

## Active Host Authority

- `room_id`: active room.
- `participant_identity`: current host participant identity.
- `connection_generation`: current session generation used to reject stale cleanup.
- `authority_version`: monotonic version associated with authoritative changes.
- `state`: connected, grace-period, transferred, or failed-over.
- Only authenticated users are eligible for active host authority. Guest
  identities remain participants but are never promoted to host.

## Participant Session

- room-scoped identity and identity type (authenticated user or guest).
- connection ID and generation.
- role: host/member/guest according to the existing protocol.
- join/last-seen timestamps used only for existing lifecycle and deterministic succession rules.

## Moderation Decision

- room and target identity/session.
- action: kick, temporary ban, lock, unlock, or host transfer.
- actor identity.
- authoritative room version and outcome.
- optional expiry for a temporary ban.

## State Transitions

1. Host connected → temporary disconnect grace → reconnect restores host, or expiry enters failover.
2. Host transfer requested → server authorization/version check → one authoritative new host.
3. Kick requested → authorization/target validation → durable moderation state → connection and media cleanup.
4. Temporary ban active → `room_bans.expires_at` denies admission/reconnect → expiry returns target to normal room policy.
5. Lock enabled → existing participants remain; new admission follows SPEC 001 lock policy.
