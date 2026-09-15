# Testing Strategy & Quality Assurance — Mingly

This document specifies the testing methodology, automated test suites, and mandatory real-browser verification matrices for **Mingly MVP 2 and MVP 3**.

---

## 1. Automated vs Real-Browser Testing Boundary

Realtime WebRTC cannot be fully validated through headless synthetic scripts alone. Mingly strictly distinguishes automated checks from real physical-device testing. SPEC 004 adds release-blocking two-peer checks for effects, raw fallback, local/remote orientation, camera switching, screen/microphone isolation, weak-device degradation, privacy, and repeated lifecycle cleanup.

```
+────────────────────────────────────────+────────────────────────────────────────+
|       AUTOMATED TEST SUITES            |      MANDATORY REAL-BROWSER TESTS      |
|    (CI/CD Blocking, Headless)          |    (Physical Webcams & Mobile Devices) |
+────────────────────────────────────────+────────────────────────────────────────+
| • Go unit & concurrency race tests     | • Camera mirroring orientation check   |
| • PostgreSQL relational integration    | • Screen-share text/orientation check  |
| • Redis Pub/Sub multi-node forwarding  | • YouTube audio gesture in two browsers|
| • Realtime protocol envelope validation| • LiveKit adaptive layer switching     |
| • Playback calculation & drift math    | • Device switching (front/rear camera) |
| • Queue permutation & version conflict | • Audio/video lip-sync under CPU load  |
| • Frontend Zustand store logic (Vitest)| • Mobile browser thermal/battery test  |
+────────────────────────────────────────+────────────────────────────────────────+
```

---

## 2. Automated Test Matrix

### A. Backend Unit & Race Tests (`go test -race ./...`)
- **Realtime Hub Tests (`internal/realtime/hub_test.go`)**:
  - Validates authentication handshake, admission limits, snapshot delivery.
  - Slow consumer test: fills client buffer to 64 frames; verifies socket is closed immediately and fast peers are unhindered.
  - Reaction rate limit test: sends 25 rapid reactions; verifies room-level rate cap (20 / 2s).
- **Media Engine Tests (`internal/realtime/media_test.go`)**:
  - Tests canonical position formula across `PLAYING` and `PAUSED` states.
  - Stale version guard: verifies mutations with mismatched `expected_version` fail with `errMediaStale`.
  - Queue permutation test: verifies invalid or duplicate track IDs in `queue.reorder` return `errInvalidMedia`.
- **Domain Authorization Tests (`internal/domain/domain_test.go`)**:
  - Exhaustive capability checks for `CanJoin`, `CanControlMedia`, `CanManageQueue`, `CanDeleteRoom`.

### B. Integration Tests
- **PostgreSQL Tests**: Executes migrations against test database; validates room cascade deletions and message ordering.
- **Redis Multi-Instance Integration**: Boots two test Go hubs subscribed to Redis Pub/Sub; verifies event published to Hub 1 is delivered to mock client on Hub 2, while checking loop-prevention discard.

### C. Frontend Unit & Store Tests (`pnpm test` / Vitest)
- `mediaClock.test.ts`: Verifies NTP clock offset calculation and drift determination.
- `stageLayout.test.ts`: Tests responsive grid column/row derivations.
- `useMusicStore.test.ts`, `useReactionStore.test.ts`: Tests Zustand store mutations and snapshot replacements.

### D. Frontend End-to-End Tests (`pnpm test:e2e` / Playwright)
- `lobby.spec.ts`: Validates Lobby landing page rendering, brand presentation, input validation, room navigation, and accessibility.
- Chromium & Mobile Chrome emulation matrices.


---

## 3. Mandatory Real-Browser Quality Verification Matrix

The following tests **must** be executed on physical hardware (laptop webcam + mobile device) before cutting an MVP 2 release:

| Test Case | Device & Browser | Action | Expected Physical Result | Pass/Fail Gate |
| :--- | :--- | :--- | :--- | :---: |
| **Mirroring Correctness** | Chrome on macOS / Windows | Enable front camera. Hold up text (e.g. printed page or logo). | Local self-view is **mirrored** (feels natural). Remote peer sees **unmirrored** text (readable left-to-right). | **Release Blocking** |
| **Rear Camera Orientation** | Safari on iOS / Chrome Android | Switch to rear (`environment`) camera. | Local preview and remote published view are both **unmirrored**. | **Release Blocking** |
| **Screen Share Non-Mirror** | Chrome Desktop | Share an IDE code window or document tab. | Remote participants see crisp, **unmirrored** code. Never flipped. | **Release Blocking** |
| **YouTube Playback** | Two independent browsers | Host adds and plays a track; each device enables audio. | Both hear the same track; play/pause/seek converge without reload. | **Release Blocking** |
| **Host Governance** | Two independent browsers | Host locks room and kicks a guest; guest attempts rejoin. | Guest leaves the room and cannot rejoin while denied; other participants continue. | **Release Blocking** |
| **Degradation Under Load** | Older Laptop or Mobile | Run a call while the CPU is throttled. | Audio remains usable; video quality may adapt without dropping the room session. | **Release Blocking** |

---

## 4. Continuous Integration (CI) Verification Commands

```powershell
# 1. Run backend tests with race detector
cd backend
go test -race -v ./...

# 2. Run backend linter
golangci-lint run

# 3. Run frontend tests, E2E checks and typechecks
cd ../frontend
pnpm test
pnpm test:e2e
pnpm lint
pnpm exec tsc --noEmit
```
