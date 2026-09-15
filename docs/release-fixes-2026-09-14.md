# Release gate fixes — 2026-09-14

This follow-up supersedes the unresolved code findings in `release-gate-2026-09-14.md`. It does not certify the previously unverified physical-device golden path.

## Fixed and verified

- **Duplicate presence:** Go Hub atomically admits one connection per verified identity per room. An existing session keeps its place; a duplicate receives `DUPLICATE_SESSION` and the frontend explains that the other tab must close. LiveKit token acquisition now follows the accepted application snapshot, so a rejected tab does not displace the original media connection through the normal UI.
- **Room capacity:** admission enforces `max_participants`, with a defensive default of 12. `ROOM_FULL` stops the frontend retry loop and displays a translated message.
- **Half-open connections:** backend reads expire after 60 seconds without an application event. The frontend checks incoming traffic and reconnects when stale, without depending on a delayed browser close callback; connection/snapshot establishment also has a deadline. Commands are gated on a received snapshot.
- **Credential recovery:** each reconnect asks Supabase for its current session token. Pending credential results are ignored after leaving. Guest credentials retain their server-issued identity and scope; expired guest credentials are not silently replaced with a new identity.
- **Shutdown:** Hub rejects new handlers, cancels active and authenticating handlers, stops room timers, and waits for owned reader/writer pumps before database teardown. No network I/O occurs under Hub locks.
- **JWKS request amplification:** concurrent refreshes share one in-flight request; unknown keys and outages have a 30-second refresh cooldown. Responses are size bounded. Known, unexpired cached keys continue to work. A newly rotated unknown key can require up to 30 seconds to become available.
- **Media state/cleanup:** UI availability follows LiveKit's real connection state. Initial device-enable promise failures are handled; late token results after unmount are ignored; leaving explicitly disconnects LiveKit before navigating. LiveKit connection errors are surfaced while chat remains separate.
- **Accessibility/lint:** mobile invite has an accessible name; removed two unused bindings. New admission messages have Vietnamese translations.
- **Distributed governance and leases:** same-tab replacement is routed across nodes, remote participant kicks close the exact socket on its owning node, and a restarted process cannot adopt a predecessor's live media lease just because `INSTANCE_ID` was reused. Locked rooms preserve same-tab guest reconnects while rejecting new guest entries.
- **Governance feedback:** kicked clients leave the LiveKit tree as soon as the application session is rejected, lock state is visible in the room header and invite lobby, and locked guest-session requests return a distinct `ROOM_LOCKED` error.
- **Short room links:** public room links use a six-digit `short_code`; the durable UUID remains internal and legacy invite codes continue to resolve.
- **Shared abuse budgets:** chat and reaction limiters now use the same bounded Redis token-bucket fallback as connection, guest, room, and media actions.
- **Volume control:** the YouTube volume popover opens by click/touch and stays open until an outside click or Escape, so moving away from the speaker icon no longer loses the slider.

## Validation actually completed

- Frontend lint: zero errors/warnings.
- Frontend tests: 11 files / 67 tests passed.
- TypeScript check and Next production build passed.
- Backend `go vet ./...`, `go test -race ./...`, `go build ./...` passed. Modified Go files formatted.
- Realtime governance regression covers lock broadcast/versioning, kick close, durable ban persistence, and banned reconnect rejection. HTTP coverage verifies locked guest-session rejection.
- New tests cover 50 concurrent admission attempts (12 distinct admitted, or exactly one when all use the same identity), duplicate-session rejection without displacing the original, active-WebSocket shutdown and rejected post-shutdown requests, idle reader expiry, and a 50-request unknown-JWKS-key burst making only one upstream request.
- Supabase negative tests now cover expired/missing expiry, wrong issuer/audience/role, invalid subject format, invalid signature, unknown key, missing and malformed tokens. Guest expiry/malformed credentials are tested.
- Frontend regression tests cover refreshed reconnect credentials, command gating before snapshot, half-open recovery without `onclose`, late async credential completion after leave, and room-full retry termination.
- Restarted the QA backend on port 18081 with real configured database access. All 15 HTTP/WebSocket smoke assertions passed, including `DUPLICATE_SESSION`, one participant per identity, cross-room denial, tamper denial and malformed/oversized event handling. Scratch runner now exits unsuccessfully if an assertion fails.

The 50-admission and JWKS tests exercise concurrent in-process behavior; they are not a 50-browser media/load benchmark. Shutdown passed in the HTTP/WebSocket integration test; an OS-signal test under full live-media load remains unverified. Redis-backed two-node routing and the physical media path still require staging services and real devices.

## Changed files

`backend/migrations/000003_short_room_codes.*`; `backend/internal/store/postgres.go`, `release_integration_test.go`; `backend/internal/realtime/hub.go`, `hub_test.go`; `backend/internal/httpapi/server.go`, `server_test.go`; `redis.go`, `redis_admission.go`, `redis_media.go`; `backend/cmd/server/main.go`; `backend/internal/auth/supabase.go`, `supabase_test.go`, `guest_test.go`; `frontend/src/lib/realtime.ts`, `realtime.test.ts`; `frontend/src/features/room/RoomSession.tsx`, `RoomView.tsx`, `MusicDrawer.tsx`; `frontend/src/app/join/[roomId]/page.tsx`; `frontend/src/types/api.ts`; `frontend/src/lib/i18n/uiText.ts`; `frontend/src/lib/auth/useAuth.ts`; `frontend/public/theme-init.js`; `README.md`; release documentation. Ignored QA smoke script/results were also updated.

## Release status

The reproduced duplicate-presence blocker is fixed. **Release is still NOT VERIFIED / NO-GO until the physical-device golden path passes:** real remote microphone audio, camera video, screen share with both stop paths, temporary network loss with independent media recovery, and full responsive screen-share checks. Those are missing validation evidence, not defects claimed fixed by unit tests. No production deployment or Git commit was performed.
