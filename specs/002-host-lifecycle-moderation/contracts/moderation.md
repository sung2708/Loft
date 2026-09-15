# Moderation Contract

The existing typed WebSocket envelope and HTTP authorization boundaries remain the public contract.
The implementation must extend equivalent existing events rather than introduce duplicate events.

## Required outcomes

| Operation | Authorized actor | Success | Denial/failure |
|---|---|---|---|
| Transfer host | Current host | One authoritative current host and snapshot update | Stale/non-host/ineligible target denied |
| Kick participant | Current host | Target removed and stale reconnect invalidated | Self, stale, missing target, or non-host denied |
| Temporary ban | Current host, if supported | Room-scoped expiry recorded and target denied until expiry | Invalid identity, stale actor, or unsupported guest guarantee denied safely |
| Lock/unlock | Existing host authority | Existing participants remain; admission policy changes | Stale version/non-host denied |

## Client-visible requirements

- Domain events describe facts, not UI or socket instructions.
- Reconnecting clients receive the current host and moderation state in the authoritative snapshot.
- Kicked users see a neutral removal message and are returned to the Lobby.
- Raw close codes, database errors, Redis errors, tokens, and secrets are never exposed.
- `host.changed` carries the public host connection, identity type, generation,
  authority version, and lifecycle state. It never carries credentials.
- `participant.ban` accepts a room-scoped duration from 1 through 24 hours;
  the current implementation exposes a one-hour UI action.
