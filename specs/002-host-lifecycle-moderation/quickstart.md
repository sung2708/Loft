# Quickstart: Host Lifecycle & Moderation

## Prerequisites

- Existing PostgreSQL, Redis, Supabase Auth, and LiveKit development configuration.
- Two or more browser clients, with at least one authenticated host.
- Optional second backend instance for cross-instance scenarios.
- Apply `backend/migrations/000005_temporary_room_bans.up.sql` before enabling
  temporary bans against an existing database.

## Automated validation

```powershell
cd backend
go test ./...
go test -race ./...
go vet ./...
go build ./...

cd ../frontend
npx tsc --noEmit
npm run test -- --run
npm run build
```

## Acceptance smoke matrix

1. Host transfers authority; all clients show one new host; old host action is denied.
2. Host refreshes or briefly loses network; grace recovery preserves host authority.
3. Host leaves beyond grace; one deterministic successor is selected; owner remains durable owner.
4. Host kicks a participant; participant returns to Lobby and cannot reconnect through stale state.
5. Non-host attempts kick/transfer/lock directly; server denies and room state is unchanged.
6. Temporary ban, if enabled, denies rejoin until expiry without claiming stronger anonymous identity than available.
7. Lock blocks new admission while current participants remain connected.
8. Repeat kick and failover scenarios with participants split across two backend instances.
9. Miss a host event, reconnect, and confirm the fresh snapshot is authoritative.

Record browser/device, backend instance, room version, expected outcome, actual outcome, and any
remaining NOT VERIFIED evidence. Never record passwords, JWTs, guest secrets, or LiveKit secrets.

## Implementation verification recorded for this iteration

- Backend unit suite: `go test ./...` — PASS.
- Backend race suite: `go test -race ./...` — PASS.
- Backend static/build checks: `go vet ./...` and `go build ./...` — PASS.
- Frontend TypeScript: `npx tsc --noEmit` — PASS.
- Frontend Vitest: `npm run test -- --run` — PASS (73 tests), including static accessibility semantics and destructive-label coverage for the participant menu and confirmation dialog.
- Frontend lint/build: `npm run lint` and `npm run build` — PASS.

| Acceptance area | Result | Evidence / limitation |
|---|---|---|
| Host transfer, grace, deterministic local failover | PASS | Hub and realtime unit tests |
| Kick stale reconnect and LiveKit cleanup path | PASS | Existing realtime tests plus Hub implementation |
| Static participant-menu/dialog accessibility semantics | PASS | Vitest component rendering (4 assertions groups) |
| Browser keyboard/touch/screen-reader moderation flow and focus return | NOT VERIFIED | Requires a browser/device session |
| Two backend instances and Redis outage fallback | NOT VERIFIED | Requires staging Redis and two service processes |
| Supabase migration `000005` | NOT VERIFIED | Must be applied to the target project |
| LiveKit remote participant cleanup | NOT VERIFIED | Requires configured LiveKit credentials and a real room |
