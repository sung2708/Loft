# Verification: Room Atmosphere (SPEC 005)

**Date**: 2026-09-16  
**Environment**: Windows 11 x64, PowerShell 7, Go 1.24, Node.js v24, Chromium / Mobile Chrome (Pixel 5 emulation via Playwright)  
**Status**: Implementation & Automated Quality Gates 100% Complete; Live Physical/Multi-Node gates marked NOT VERIFIED per strict specification rules.

---

## 1. Automated Verification Gates

| Gate / Command | Exit Code | Result | Pass/Fail/Skipped | Evidence / Notes |
|---|---|---|---|---|
| `go test ./...` | `0` | **PASS** | 10 packages passed (0 failed) | All domain, store, httpapi, realtime, auth, and telemetry tests passed. |
| `go test -race ./...` | `0` | **PASS** | 10 packages passed (0 failed) | Concurrency race detector clean across all packages. |
| `go vet ./...` | `0` | **PASS** | 0 warnings | Clean Go idioms and no static analysis errors. |
| `go build ./...` | `0` | **PASS** | Binary compiled | Server binaries built successfully without issues. |
| `pnpm test` | `0` | **PASS** | 31 test files, 140 passed (0 failed) | All unit and component tests passed (including `RoomAtmosphere`, `RoomSettings`, `RoomSession`, `adaptivePalette`, `degradation`, `ThemeProvider`). |
| `pnpm lint` | `0` | **PASS** | 0 errors, 0 warnings | ESLint clean after refactoring `appearancePending` state derivation in `RoomView.tsx` and removing unused imports. |
| `pnpm exec tsc --noEmit` | `0` | **PASS** | 0 type errors | Strict TypeScript compilation clean. |
| `pnpm build` | `0` | **PASS** | 8 routes compiled | Next.js production build and static page generation succeeded. |
| `pnpm test:e2e` | `0` | **PASS** | 56 passed (0 failed) | Full Playwright E2E suite passed (`lobby`, `responsive`, `spec001`, `spec005`) across Chromium & Mobile Chrome. |

---

## 2. Playwright E2E Matrix (`spec005_room_atmosphere.spec.ts`)

- **Browsers**: Chromium (Desktop Chrome), Mobile Chrome (Pixel 5)
- **Viewports Tested**:
  - `1440x900` (Desktop Large)
  - `1280x720` (Desktop HD)
  - `1024x768` (Tablet Landscape)
  - `768x1024` (Tablet Portrait)
  - `430x932` (Mobile - iPhone 14 Pro Max)
  - `375x667` (Mobile - iPhone SE)
- **Scenarios Verified**:
  1. Host switches through all 4 atmospheres: Minimal, Ambient, Focus, Party.
  2. Host switches through all 5 accents: Blue, Purple, Green, Orange, Rose.
  3. Participant menu scoping: Participant cannot see or trigger room atmosphere controls or accent choices.
  4. Personal theme independence: Switching room atmosphere does not alter `loft.theme` in `localStorage` or personal light/dark/system mode.
  5. Privacy / Network Audit: Zero arbitrary image uploads, zero palette uploads, zero media frames over WebSocket, zero arbitrary CSS/URLs.
  6. Responsive bounds: Zero horizontal overflow across all 6 viewports.
  7. Reduced motion: Obeys `prefers-reduced-motion: reduce` without continuous or strobe animations.

---

## 3. Bugs Discovered & Fixed During Verification

1. **SSR Hydration in `useRoomStore`**:
   - *Symptom*: Component tests using `renderToStaticMarkup` or SSR rendered `room: null` because Zustand v5 `useSyncExternalStore` called internal `api.getInitialState()` which was bound to default initial state.
   - *Fix*: Bound `api.getInitialState = () => api.getState();` inside `useRoomStore.ts`.
   - *Regression Test*: `src/features/room/RoomAtmosphere.test.tsx` and `src/components/room/RoomSettings.test.tsx`.

2. **Cascading Render in `RoomView.tsx`**:
   - *Symptom*: ESLint reported `react-hooks/set-state-in-effect` when resetting `appearancePending` inside `useEffect`.
   - *Fix*: Replaced imperative `useEffect` with declarative state derivation: `const appearancePending = pendingVersion !== null && room?.version === pendingVersion && !governanceError;`.
   - *Regression Test*: `pnpm lint` exit code 0.

3. **Missing Host and Self Fixtures in Frontend Tests**:
   - *Symptom*: `tsc --noEmit` caught type errors in `ThemeProvider.test.tsx` and `RoomAtmosphere.test.tsx` where `host: null` and `self: null` were provided instead of valid objects.
   - *Fix*: Replaced `null` with strongly typed `HostAuthority` and `ApiParticipant` test fixtures.
   - *Regression Test*: `pnpm exec tsc --noEmit` exit code 0.

4. **PostgreSQL NULL Scan Safety on Legacy / Unmigrated Rows**:
   - *Symptom*: Reading unmigrated rows or legacy rows without default values could cause SQL scan errors or uninitialized appearance fields.
   - *Fix*: Wrapped `COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true)` across all room SELECT/UPDATE queries in `postgres.go` and normalized with `domain.NormalizeRoomAppearance`.
   - *Regression Test*: `go test ./...` in `backend/internal/store`.

5. **Missing Vietnamese Localized Labels**:
   - *Symptom*: UI displayed raw English keys in Vietnamese locale; Playwright text matcher had strict mode collision on "Tối" vs "Tối giản".
   - *Fix*: Added localized dictionary entries in `uiText.ts` and updated regex in E2E tests to exact boundaries (`/^dark$|^tối$/i`).
   - *Regression Test*: `pnpm test:e2e` passed all 56 tests.

---

## 4. Architectural & Privacy Invariants Audit

- [x] **PostgreSQL is durable source of truth**: Room appearance (`atmosphere`, `accent`, `adaptive_media_background`) is stored in `rooms` table with monotonic `version`.
- [x] **Zero Media via WebSocket**: WebSockets only transmit typed JSON envelopes.
- [x] **No I/O under Realtime Locks**: Hub locks are released before database or Redis I/O.
- [x] **Redis is Ephemeral**: Redis Pub/Sub only relays `room.appearance.updated` events; no durable data or media frames are stored in Redis.
- [x] **Personal Theme Independence**: Personal `light|dark|system` and `localStorage.getItem("loft.theme")` are never overridden by room appearance.
- [x] **Snapshot Recovery Over Event Replay**: Reconnecting clients fetch fresh `room.snapshot`.
- [x] **Zero Client Authority on Permissions**: Only current host can mutate appearance; stale `expected_version` triggers conflict.

---

## 5. Items Explicitly NOT VERIFIED (Per Mandatory Instructions)

Per the strict instructions in the user request:
*"Nếu không có camera, LiveKit, Redis hai instance, thiết bị mobile thật hoặc Supabase test database thì ghi `NOT VERIFIED`; không giả lập kết quả PASS."*

The following real-world/hardware execution scenarios were not executed against live physical instances in this automated session and are strictly recorded as **NOT VERIFIED**:

1. **Live Supabase Database Migration**:
   - Status: `NOT VERIFIED` on remote Supabase production database. (Migration SQL files `000006_room_appearance.up.sql` and `down.sql` verified syntactically and functionally in automated store tests).
2. **Live Redis Multi-Instance Deployment**:
   - Status: `NOT VERIFIED` on a live multi-instance Redis cluster with two running Go server processes. (Multi-instance behavior verified via in-process Redis pub/sub tests in `backend/internal/realtime/redis_test.go`).
3. **Manual Two-Peer Chrome with Live Video/Audio Tracks**:
   - Status: `NOT VERIFIED` with real human peers using live camera devices and real LiveKit SFU media streaming. (Automated headless two-peer scenarios verified via Playwright E2E).
4. **Physical Mobile Device Testing**:
   - Status: `NOT VERIFIED` on physical mobile hardware (e.g. physical iPhone or Android handheld). (Mobile viewports 375 and 430 verified via Chromium mobile emulation).
