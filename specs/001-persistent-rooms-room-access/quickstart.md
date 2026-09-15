# Quickstart Validation: Persistent Rooms & Room Access

This guide validates the user-visible behavior and regression boundaries for SPEC 001. It is a
validation guide, not an implementation recipe.

## Prerequisites

- Loft backend and frontend configured as described in `README.md`.
- PostgreSQL with the current migrations and the SPEC 001 migration applied.
- Redis configured for multi-instance/rate-limit checks; also run the documented bounded fallback
  test when Redis is unavailable.
- Two browser profiles: one authenticated owner and one logged-out guest.
- Two backend instances or the existing multi-instance test harness for consistency checks.

## Baseline Checks

From the repository root:

```powershell
cd backend
go test -race ./...
go vet ./...
go build ./...

cd ../frontend
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Expected result: all existing MVP1/MVP2 checks pass before feature-specific acceptance begins.

## Core Acceptance Run

1. Authenticate as Linh and create `Late Night Coding` with guest access enabled and no password.
2. Copy the reusable public invite/short-code link. Leave the room with all participants.
3. Reopen the Lobby as Linh and verify the room remains listed and re-enterable.
4. Open the invite in the logged-out browser as Minh. Verify guest joining succeeds without account
   creation.
5. Enable password protection as Linh. Verify the preview indicates that a password is required but
   does not expose a secret.
6. Attempt guest admission with no password and a wrong password. Verify both are denied with calm,
   actionable copy and no secret-bearing response/log.
7. Join with the correct password. Verify the normal room session and LiveKit admission still work.
8. Submit repeated wrong passwords until temporary protection occurs; wait for cooldown and verify a
   legitimate retry succeeds. Repeat through another backend instance.
9. Lock the room. Verify current participants remain connected and a new guest sees the locked-room
   message. Unlock and verify admission follows the current password rule.
10. Change the password while participants remain connected. Verify current sessions remain connected,
    old password admission fails, and new password admission succeeds.
11. Briefly interrupt Minh's network and refresh/reconnect. Verify valid sessions receive a fresh
    snapshot; invalidate access during the interruption and verify re-entry is denied safely.
12. Explicitly delete the room as Linh and confirm. Verify later links do not recreate or enter it.
    Verify canceling the confirmation leaves it unchanged.

## Regression Matrix

Run the existing browser acceptance flow from `README.md` and confirm no regression in:

- Lobby and authenticated room creation
- Legacy invite and UUID compatibility
- Guest join and authenticated join
- Chat persistence and presence
- Microphone, camera, screen share, and LiveKit token issuance
- Lock, kick/ban, duplicate-session, and snapshot reconnect behavior
- YouTube playback and collaborative queue behavior
- Light, dark, and system theme; keyboard and mobile access flow

## Evidence to Record

- Room identifiers and policy versions only; never record passwords, verifiers, or credentials.
- HTTP/WS outcomes for each scenario, including receiving instance identity where needed.
- Browser screenshots or accessibility inspection results for preview, password, lock, error, and
  delete-confirmation states.
- Race-test, frontend-test, lint, type-check, build, and multi-instance results.
- Redis outage/fallback result and confirmation that durable room data remains intact.

## Latest Automated Evidence

- Backend: `go test ./...` passed after the room-access migration, verifier, admission, and settings
  changes.
- Frontend: TypeScript `tsc --noEmit` passed.
- Frontend: Vitest passed with 11 test files and 67 tests.
- `git diff --check` reported no whitespace errors; browser/device and two-instance external-service
  validation still require a configured staging environment.
