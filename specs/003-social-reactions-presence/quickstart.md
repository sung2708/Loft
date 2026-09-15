# Quickstart: Social Reactions & Presence Validation

## Prerequisites

- Existing local frontend/backend configuration.
- PostgreSQL, Redis, Supabase Auth, and LiveKit when running full integration scenarios.
- Two browsers or isolated profiles; an optional second backend instance.
- Review candidate WAV ownership/quality before copying approved assets to `frontend/public/sfx`.
- No database migration is required.

## Automated Gates

```powershell
cd backend
go test ./...
go test -race ./...
go vet ./...
go build ./...

cd ../frontend
npx tsc --noEmit
npm run test -- --run
npm run lint
npm run build
```

Add focused tests for:

- Exact five-reaction validation, spoof rejection, participant/room bursts, and distributed limit fallback.
- Wave attribution, multi-instance fanout, rate limiting, and no persistence.
- Raise/lower idempotency, expected-version conflict, stale socket, same-tab reconnect, grace expiry,
  kick/ban, room emptying, and remote convergence.
- Snapshot default compatibility and absence of reaction/Wave replay.
- Reaction grouping/expiry cap, cleanup, reduced motion, accessible popover, and focus return.
- SFX policy categories, preferences, volume isolation, bounded voices, blocked autoplay, missing
  assets, and unmount cleanup.

## Browser Acceptance Matrix

Run at 1440, 1280, 1024, 768, 430, and 375 widths:

1. Two participants send all five reactions; verify attribution, Stage stability, silence, and expiry under 5 seconds.
2. Send 100 attempts over 10 seconds; verify at most 6 visible groups and unaffected call audio.
3. Wave; verify room-level ephemeral feedback and no chat entry.
4. Raise Hand, refresh/reconnect within grace, lower it, then leave; verify one participant and no ghost state.
5. Replace a same-tab socket and close the old socket; verify newer hand/presence survives.
6. Kick and temporarily ban a raised participant; verify SPEC 002 wins and social state clears.
7. Share screen and react on 375/430 widths; verify screen, strip, Call Dock, and chat do not overlap.
8. Use keyboard and screen reader for Reaction, Wave, Raise/Lower Hand; verify labels, state, Escape,
   focus return, and non-motion meaning.
9. Enable reduced motion; verify simplified feedback and stable LiveKit tracks.

## SFX Acceptance

1. After a user gesture, toggle mute/camera/share and verify only the local actor hears enabled UI cues.
2. Join/leave with two participants and verify Room Sounds preference is respected.
3. Disable Sound Effects and Room Sounds independently; verify call and shared-media volume never change.
4. Confirm reactions and chat are silent.
5. Block autoplay and remove one optional test asset; verify no repeated raw error and no room feature fails.
6. Trigger rapid eligible events; verify playback voices remain bounded and low-priority cues may drop.

## Multi-Instance and Failure Matrix

1. Put participants on Instances A/B with Redis healthy; verify accepted Reaction, Wave, and Hand events converge.
2. Attempt rate-limit bypass through both instances; verify one effective identity allowance.
3. Interrupt Redis; verify same-instance core room/call operation, bounded local social behavior, no panic,
   and observable cross-instance degradation.
4. Restore Redis; verify subscription recovery without replaying old reactions/Waves and snapshot recovery of current hands.
5. Repeat reconnect, stale-close, host transfer, kick, LiveKit share, chat, YouTube, and queue regression cases.

## Evidence Record

For every scenario record command/browser, viewport, instance IDs, expected result, actual result,
PASS/FAIL/NOT VERIFIED, and relevant non-secret logs. Never record passwords, JWTs, guest secrets,
Redis credentials, Supabase secrets, or LiveKit secrets. Automated success does not substitute for
real-browser or two-instance verification.

## Implementation Evidence — 2026-09-15

- `go test ./...` — PASS.
- `go test -race ./...` — PASS.
- `go vet ./...` — PASS.
- `go build ./...` — PASS.
- `npx tsc --noEmit` — PASS.
- `npm run test -- --run` — PASS (18 files, 83 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS (Next.js 16.3.5 production build).

| Acceptance area | Result | Evidence / limitation |
|---|---|---|
| Five-value reaction validation and retired-value rejection | PASS | Go domain and WebSocket tests |
| Raise Hand state, snapshot defaults, reconnect preservation, stale remote version | PASS | Go and Zustand tests |
| Room-level Wave command/fact and bounded frontend presentation | PASS | WebSocket and store tests |
| SFX preferences, category isolation, unlock and bounded voices | PASS | Vitest plus fixed manifest |
| WAV technical decode/trailing-silence optimization | PASS | ffprobe/ffmpeg inventory in `sfx-assets.md` |
| Two-instance Redis outage/recovery and limit bypass | NOT VERIFIED | Requires two live services and Redis |
| Chrome viewport/keyboard/touch/screen-reader/reduced-motion matrix | NOT VERIFIED | Requires browser acceptance session |
| LiveKit track stability and physical call audio under a 100-event burst | NOT VERIFIED | Requires configured real room/devices |
| WAV redistribution rights and subjective sonic mastering | NOT VERIFIED | Requires product/legal listening approval |

Architecture audit found no social PostgreSQL writes or migration, server-directed SFX event,
automatic AFK state, arbitrary reaction rendering, second realtime/presence client, or unbounded
per-reaction task. SFX playback exists only in the fixed frontend manifest/manager. Existing
`loft.*` internal compatibility keys remain intentional; Mingly is used for current product copy.
