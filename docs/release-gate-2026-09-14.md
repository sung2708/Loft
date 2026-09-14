# LOFT MVP 1 — RELEASE GATE

Follow-up: the code findings below were subsequently addressed; see [release fixes and retest results](release-fixes-2026-09-14.md). This document preserves the original audit evidence.

Date: 2026-09-14 (Asia/Bangkok)

**RELEASE VERDICT: NO-GO**

Commit/build tested: working directory has no Git commit; files are untracked. Next production build ID: `wTxhuK6GHCwuPw9CSGh14`. This is a local release audit, not a deployed-production certification.

## Decision and gate results

An actual duplicate-presence defect remains. Real remote audio, video, screen sharing and network recovery have not passed the mandatory golden path. Green compilation and unit tests do not satisfy those gates.

PASS below applies only to the stated evidence. NOT VERIFIED means the complete gate was not executed; partial successes are recorded separately.

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Build | PASS | Frontend and backend validation commands succeeded. |
| Environment / clean start | NOT VERIFIED | Backend loads `backend/.env`; frontend uses `.env.local`; both started. Existing dependencies and Supabase infrastructure were used; fresh provisioning not proven. Docker daemon unavailable. |
| Database | NOT VERIFIED | Real isolated-schema migration, inserts, foreign-key relationships and room-delete cascades passed and rolled back. Requires existing Supabase auth schema, roles and one auth fixture; not an empty-instance provisioning test. App-restart persistence not explicitly tested. |
| Supabase Auth | NOT VERIFIED | Restored authenticated browser session works; existing ES256/JWKS test passed; forged/missing credentials rejected. Full expired/issuer/audience/unknown-kid attack matrix and fresh Google OAuth not executed. |
| Guest Auth | NOT VERIFIED | Real anonymous guest join, Unicode name, room scope and tamper rejection passed. Full expiry/name-boundary matrix not executed. |
| Room Authorization | NOT VERIFIED | Authenticated create succeeded; anonymous create rejected. Full forged-owner/role and guest-create matrix not executed. |
| Presence | **FAIL** | Two WebSockets authenticated as the same guest produce two entries for one identity. Normal two-browser join, refresh and leave passed. |
| Chat | NOT VERIFIED | Two-way real chat, viewer-relative alignment, emoji, literal HTML/script text, refresh history passed. Full duplicate/burst/multiline/length matrix not executed. |
| WebSocket | NOT VERIFIED | Real auth, snapshots, unknown event, malformed JSON and oversized payload checked. Slow-consumer regression fixed and passed. Full lifecycle/load matrix outstanding. |
| Voice | NOT VERIFIED | LiveKit token endpoint returned 200; remote audio was not heard/verified. |
| Camera | NOT VERIFIED | Guest camera was clicked but no live remote video or actionable permission surface was observed. This is not proof of working video or a diagnosed camera defect. |
| Screen Share | NOT VERIFIED | Native picker, remote track, layout and both stop paths not exercised. |
| Reconnect / Resync | NOT VERIFIED | Refresh succeeded; a temporary network interruption with independent LiveKit recovery was not tested. |
| Responsive | NOT VERIFIED | Inspected two-person desktop and 375×667 mobile layout; full six-width, share/chat/constrained-height matrix outstanding. |
| Theme | NOT VERIFIED | Light host and dark guest rendering observed; system theme and switching matrix not completed. |
| Animation | NOT VERIFIED | 1→2 and 2→1 participant state transitions observed; track continuity/reduced-motion not verified. |
| Accessibility | NOT VERIFIED | Mobile invite button exposed no accessible name in AX tree. Full keyboard/focus/contrast audit not completed. |
| Security | NOT VERIFIED | Several attacks denied; no security certification from this partial matrix. Full history/secret scan unavailable with no Git history. |
| Go Race Test | PASS | `go test -race ./...` passed after fix. |
| Graceful Shutdown | NOT VERIFIED | Connected-client shutdown, goroutine completion and recovery not measured. |
| Production Build | PASS | `pnpm build`, `go build ./...`; `pnpm start --port 3100` ready and HTTP 200. |
| Golden Path | **NOT VERIFIED** | Host/guest join and chat work; required real media and network recovery steps incomplete. Release remains NO-GO. |

## Commands actually executed

From `frontend`:

```powershell
pnpm lint
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm start --port 3100
```

Frontend: 8 test files, 27 tests passed. Lint has zero errors and two warnings (`public/theme-init.js`, `src/lib/auth/useAuth.ts`). Production HTTP smoke returned 200. Browser functional tests used the existing development server on port 3000, not the new production runtime.

From `backend`:

```powershell
gofmt -l cmd internal
go vet ./...
go test ./...
go test -race ./...
go build ./...
go test ./internal/realtime -run TestSlowConsumerDoesNotBlockBroadcast -count=1
go test -race ./internal/realtime -run TestSlowConsumerDoesNotBlockBroadcast -count=1
$env:LOFT_RELEASE_DB_TEST='1'
go test ./internal/store -run TestReleaseMigrationInIsolatedSchema -count=1 -v
```

Slow-consumer test failed before the fix after its three-second deadline; passed after the fix. Full backend vet/test/race/build/format checks passed afterward. DB integration test passed against the configured real database and rolled back.

Started independent backend instances using `HTTP_ADDR=127.0.0.1:18080` and `127.0.0.1:18081`, then `go run ./cmd/server`. Restricted instance: `/health` 200, `/ready` 503. Instance with approved network access: both 200. This checks dependency-sensitive readiness, not the complete failure-injection matrix.

Ran `node .cache/release-gate/smoke.cjs`. Local evidence is `.cache/release-gate/smoke-results.json` (ignored scratch artifacts). Logical results must be inspected: the script can exit zero while a check fails.

| API/WS check | Observed |
| --- | --- |
| Anonymous room creation | 401 |
| Forged JWT | 401 |
| Unapproved CORS origin | 403 |
| Unicode guest-session creation | 201 |
| Same-room guest history | 200 |
| Guest credential in another room | 401 |
| Tampered guest credential | 401 |
| LiveKit token issuance | 200 |
| Same guest connected twice | **2 participant entries, expected 1** |
| Unknown WS event | `UNKNOWN_EVENT` |
| Malformed JSON | Close 1007 |
| Oversized event | Close 1009 |

## Browser scenarios actually executed

Chrome with an existing Google-authenticated session created `Release gate 2026-09-14`. Independent in-app browser opened its invite and joined without login as `Khách QA 👋`. Both saw the same two participants.

Host sent `hello — release gate`; guest sent `hey 👋 <script>alert(1)</script>`. Screenshots confirmed own messages on the right and remote messages on the left in both browsers. Script markup appeared as literal text. Refresh restored identities and two participants; guest chat history remained visible. Guest left through the dock, returned to the lobby, and host presence changed to one with the solo camera-off state.

Guest console warning/error sample was empty. This is only a sampled result, not a complete network/hydration/retry-loop audit. Fresh OAuth and logout were not performed against the user's existing signed-in browser session.

Test room ID: `25e0fd29-9543-4844-a361-a5074ec5dfdd`. The room and two QA chat messages remain in the configured database for inspection; they were not permanently deleted.

## Defects and risks

### P0

No P0 reproduced in executed checks. Incomplete security coverage does not establish absence of P0 defects.

### P1 — unresolved release blocker

**Duplicate identity in presence.** Obtain one guest token for the test room, open two authenticated WebSockets with that token, inspect the second `room.snapshot`: the same identity occurs twice. `Hub` registers clients by connection ID and snapshots expose each connection as a participant. This violates the required one-person view and needs a deliberate identity/session policy consistent with LiveKit identity. README currently permits multiple-tab presence, which conflicts with this release requirement. No fix claimed for this issue.

### P1 — fixed and retested

**Slow consumer blocks broadcast.** A saturated outbound queue caused `broadcast` to call the graceful WebSocket `Close`, waiting for a peer that may never read or acknowledge. The regression reproduced a blocked broadcast. Changed this path to `CloseNow`; healthy recipient still receives its event and the broadcast completes. Race tests passed.

### P2 / follow-up findings

- Mobile invite button had no accessible name in the inspected AX tree.
- Static inspection: application WebSocket read loop lacks a heartbeat expiry deadline. Half-open/ghost cleanup needs failure testing.
- Static inspection: frontend reconnect reuses its initial credential; expired-token recovery needs validation.
- Static inspection: shutdown calls HTTP shutdown without an explicit Hub shutdown lifecycle. Connected WebSocket cleanup remains unverified.
- Static inspection: room `max_participants` is not enforced in Hub registration. Capacity and 10/25/50-connection behavior need validation.
- Static inspection: unknown JWT key refresh behavior may amplify JWKS fetches. No load failure reproduced.

These static concerns are not presented as reproduced runtime failures.

### P3

Two existing lint warnings. No additional cosmetic changes made.

## Fix scope and authority

Go Hub owns application room membership and broadcast delivery. LiveKit remains responsible for all media transport. The fix changes only slow-peer disconnection; it introduces no protocol/API changes, extra goroutines, auth changes or network I/O under room locks. Outgoing channels remain bounded. No new metrics were added; normal connection lifecycle handling remains in place.

Files changed during this release audit:

- `backend/internal/realtime/hub.go`: immediate termination of saturated slow peers.
- `backend/internal/realtime/hub_test.go`: `TestSlowConsumerDoesNotBlockBroadcast` regression.
- `backend/internal/store/release_integration_test.go`: explicit opt-in real migration test with isolated schema and rollback.
- `docs/release-gate-2026-09-14.md`: this report.

Earlier music and room-link metadata changes are not newly implemented fixes from this audit.

## Environment classification

Values were not included in this report.

| Variables | Classification |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC; required for browser auth; configured |
| `NEXT_PUBLIC_API_URL` | PUBLIC; optional localhost fallback; explicit deployment value required operationally |
| `NEXT_PUBLIC_LIVEKIT_URL` | PUBLIC; required for media; configured |
| `DATABASE_URL`, `SUPABASE_URL`, `GUEST_TOKEN_SECRET` | SERVER-ONLY; required by backend validation; configured |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | SERVER-ONLY; required operationally for media; configured, not mandatory in config validation |
| `HTTP_ADDR`, `FRONTEND_ORIGINS`, `SUPABASE_JWT_AUDIENCE` | SERVER-ONLY; optional defaults |
| `SUPABASE_JWT_SECRET` | SERVER-ONLY; optional legacy signing support |
| `LIVEKIT_URL` | SERVER-ONLY config field; loaded, no backend operational usage found |
| `LOFT_RELEASE_DB_TEST` | Optional test-only opt-in; not production configuration |

Env files are ignored. Frontend application env references use public keys; no claim of a complete compiled-artifact secret scan. No Git commit/history exists to audit. Production-path TODO/mock/fake/FIXME/bypass search found only an explanatory UI comment about not using a fake avatar; no fake core flow found by that search.

## Required before GO

Fix duplicate identity presence and test reconnect overlap and multi-tab behavior. Run a fresh production-runtime golden path with real microphone, camera and screen-share devices in independent clients. Complete network interruption/resync, expired-auth recovery, graceful shutdown and track cleanup validation. Complete the screen-share six-width matrix, modest burst/slow-client load and outstanding security cases. Repeat the final golden path last.

The available browser surface did not establish real camera/microphone/share permissions or remote tracks. Docker provisioning was unavailable. Load, full failure injection, fresh OAuth/logout and complete responsive/security matrices were not completed in this audit. These remain NOT VERIFIED; they are not waived for release.
