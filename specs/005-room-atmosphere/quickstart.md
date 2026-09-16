# Quickstart: Validate Room Atmosphere

## Prerequisites

- PostgreSQL and Redis available using the existing local configuration.
- Backend and frontend dependencies installed.
- Valid LiveKit configuration for two-peer camera/screen-share checks.
- Two browser profiles or devices; at least one mobile-sized browser for responsive checks.

Apply sequential migration `000006_room_appearance.up.sql` through the project's normal migration process, then start the existing backend and frontend. Rolling deployments must run the migration before starting a backend binary that selects the new non-null columns; rollback removes only SPEC 005 fields and loses saved room appearance, so use it only before production appearance data is relied upon.

## Automated quality gates

```powershell
cd backend
go vet ./...
go test ./...
go test -race ./...
go build ./...

cd ../frontend
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm test:e2e
```

Expected: every command exits successfully; no race, type, lint, build, responsive-overflow, or protocol regression is reported.

## Core two-peer validation

1. Create a room and join from a second profile.
2. Confirm the room starts Ambient while each profile retains its own Light/Dark/System setting.
3. As host, select Minimal, Ambient, Focus, and Party; verify both profiles converge and no call/media state changes.
4. Attempt a change as the guest; verify rejection and authoritative reconciliation.
5. Transfer host; verify appearance stays fixed, old host loses mutation authority, and new host can change it.
6. Change accent through all approved choices; verify decorative surfaces change while focus, danger, success, and destructive controls remain semantically stable.

## Recovery and multi-instance validation

1. Save Party + Rose, leave until the room is empty, restart backend, and rejoin; verify persistence.
2. Disconnect one participant, change to Focus, reconnect; verify snapshot convergence without replay dependency.
3. Join late after a change; verify no stale/default appearance remains after bootstrap.
4. Route peers through separate backend instances and change appearance; verify convergence through the existing event bus.
5. Race stale expected versions; verify exactly one authoritative result and no partial persistence.

## Media and Stage isolation

1. Enable adaptive background and start supported shared YouTube media; inspect that analysis happens once for the video and no media/artwork blob crosses backend WebSocket/Redis traffic.
2. Change videos and end playback; verify smooth controlled transition, stale palette cleanup, and no player/Stage/track remount.
3. Block thumbnail loading/decoding; verify static room accent fallback and uninterrupted playback.
4. Start screen share in Party; verify the screen is primary and unmodified, atmosphere recedes, and participant strip/Call Dock remain non-overlapping.
5. Enable SPEC 004 Blur + Glasses; verify the participant camera effect and room atmosphere coexist without state or pixel-processing crossover.

## Accessibility, responsive, and degradation checks

- Test all modes in Light and Dark at 1440, 1280, 1024, 768, 430, and 375 widths.
- Verify readable labels/controls, visible focus, stable semantic colors, safe areas, no horizontal overflow, and no Call Dock overlap.
- Enable reduced motion and confirm Party remains recognizable without continuous movement or flashing.
- Simulate constrained CPU/GPU and rendering failures; confirm static fallback occurs before any voice, camera, screen-share, media, chat, or reconnect degradation.

Record real-browser evidence and mark unexecuted physical-device cases `NOT VERIFIED`; automated PASS does not substitute for those release checks.
