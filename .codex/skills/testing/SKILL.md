# Skill: Testing Methodology & Quality Assurance

## WHEN TO USE THIS SKILL
Use this skill whenever authoring unit tests, integration tests, concurrency race tests, protocol codecs, mock fixtures, or executing real-browser quality verifications.

## SOURCE OF TRUTH
- **Testing Specifications**: [testing-strategy.md](file:///d:/git/Loft/docs/testing-strategy.md).
- **Automated Backend Suites**: `backend/**/*_test.go`.
- **Automated Frontend Suites**: `frontend/src/**/*.test.ts`.

## ARCHITECTURAL BOUNDARIES
- Strict separation between automated tests (CI blocking, headless) and real-browser physical tests (webcam mirroring, vision filters, audio lip-sync).
- All Go concurrency tests must pass with `go test -race ./...`.
- Tests must be deterministic: zero arbitrary `time.Sleep()` waits; use synchronization channels or condition polling with deadlines.

## REQUIRED WORKFLOW
1. **Automated Backend Unit & Race Testing**:
   - Write table-driven unit tests for domain evaluators and timestamp math.
   - For WebSocket hub: use `net/http/httptest` with `coder/websocket` client to verify handshake, snapshots, rate limits, and slow-consumer termination.
   - Run `go test -race -v -count=1 ./...`.
2. **Automated Frontend Store Testing**:
   - Write Vitest tests for Zustand stores (`useMusicStore.test.ts`, `useReactionStore.test.ts`).
   - Run `pnpm test`.
3. **Mandatory Real-Browser Physical Verification**:
   - Front-camera preview mirroring: Verify local view is mirrored, remote published track is unmirrored.
   - Rear-camera orientation: Verify preview and published track are unmirrored.
   - Screen-share track: Verify code text is crisp and never mirrored.
   - Vision filters: Verify MediaPipe sunglasses/ears track facial movements smoothly; verify blur feathering.
   - Zero-remount check: Rapidly toggle filter ON/OFF; verify WebRTC video switches in-place without React stage remount.

## IMPLEMENTATION RULES
- **No Flaky Sleeps**: Never use `time.Sleep(500 * time.Millisecond)` to await async events. Use waitgroups, channels, or polling helpers.
- **Race Detector Gate**: Any pull request introducing a data race under `go test -race ./...` is release-blocking.

## FAILURE CASES
- If a test fails under `-race`: Identify the missing lock scope or concurrent channel read immediately.
- If MediaPipe WASM fails to initialize in headless CI: Mock the vision detector module in Vitest; leave visual tracking verification to physical device testing.

## TEST REQUIREMENTS
- 100% pass on `go test -race ./...`.
- 100% pass on `pnpm test` (Vitest) and `pnpm exec tsc --noEmit`.
- Physical device signoff on camera mirroring and video filter tracking.

## DO NOT
- DO NOT rely solely on headless CI to validate camera mirroring or visual filter quality.
- DO NOT ignore race detector warnings.
- DO NOT check in live API keys or production database credentials in test fixtures.

## DONE WHEN
- Automated tests pass with zero race warnings.
- Real-browser quality matrix is verified on physical hardware.
- Zero memory leaks or dangling goroutines detected.
