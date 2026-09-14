# Testing Strategy & Quality Assurance — Loft

This document specifies the testing methodology, automated test suites, and mandatory real-browser verification matrices for **Loft MVP 2**.

---

## 1. Automated vs Real-Browser Testing Boundary

Realtime WebRTC and client-side computer vision cannot be fully validated through headless synthetic scripts alone. Loft strictly distinguishes what must be automated from what requires real physical device testing:

```
+────────────────────────────────────────+────────────────────────────────────────+
|       AUTOMATED TEST SUITES            |      MANDATORY REAL-BROWSER TESTS      |
|    (CI/CD Blocking, Headless)          |    (Physical Webcams & Mobile Devices) |
+────────────────────────────────────────+────────────────────────────────────────+
| • Go unit & concurrency race tests     | • Camera mirroring orientation check   |
| • PostgreSQL relational integration    | • MediaPipe face filter anchor tracking|
| • Redis Pub/Sub multi-node forwarding  | • Background blur edge feathering      |
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

---

## 3. Mandatory Real-Browser Quality Verification Matrix

The following tests **must** be executed on physical hardware (laptop webcam + mobile device) before cutting an MVP 2 release:

| Test Case | Device & Browser | Action | Expected Physical Result | Pass/Fail Gate |
| :--- | :--- | :--- | :--- | :---: |
| **Mirroring Correctness** | Chrome on macOS / Windows | Enable front camera. Hold up text (e.g. printed page or logo). | Local self-view is **mirrored** (feels natural). Remote peer sees **unmirrored** text (readable left-to-right). | **Release Blocking** |
| **Rear Camera Orientation** | Safari on iOS / Chrome Android | Switch to rear (`environment`) camera. | Local preview and remote published view are both **unmirrored**. | **Release Blocking** |
| **Screen Share Non-Mirror** | Chrome Desktop | Share an IDE code window or document tab. | Remote participants see crisp, **unmirrored** code. Never flipped. | **Release Blocking** |
| **Face Filter Tracking** | Chrome Desktop | Select "Sunglasses" or "Bunny Ears". Tilt head $\pm 45^\circ$. | Accessories track eyes/forehead smoothly without jitter or popping off. | Visual Signoff |
| **Background Blur Feathering** | Edge / Safari Desktop | Enable "Blur" effect. Move hand across frame. | Edges feather smoothly; fingers do not aggressively clip in and out. | Visual Signoff |
| **Degradation Under Load** | Older Laptop or Mobile | Run CPU stress test while filter is active. | Filter FPS drops to 15fps or blur-only, but **audio remains crystal clear**. | **Release Blocking** |
| **Zero Remount on Toggle** | Chrome Desktop | Toggle filter ON/OFF 5 times rapidly. | Participant video switches in-place; React stage does not flicker or remount. | **Release Blocking** |

---

## 4. Continuous Integration (CI) Verification Commands

```powershell
# 1. Run backend tests with race detector
cd backend
go test -race -v ./...

# 2. Run backend linter
golangci-lint run

# 3. Run frontend tests and typechecks
cd ../frontend
pnpm test
pnpm lint
pnpm exec tsc --noEmit
```
