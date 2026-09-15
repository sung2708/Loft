# Implementation Plan: Video Effects Pipeline

**Branch**: `[004-video-effects-pipeline]` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-video-effects-pipeline/spec.md`

## Summary

Extend Mingly's existing single LiveKit camera lifecycle with one participant-local, generation-controlled video processor. It receives the raw `LocalVideoTrack`, conditionally runs only capabilities required by the selected Background/Look/AR combination, composites one unmirrored canvas output, and uses LiveKit's installed `TrackProcessor` contract to replace the sender track in place. Raw camera remains the default and fallback; microphone and screen share remain untouched.

Use one `@mediapipe/tasks-vision` runtime for both person segmentation and face landmarks, with lightweight app-owned 2D AR assets and color transforms in the same compositor. Heavy code, WASM, models, and assets load lazily. No backend, database, Redis, WebSocket protocol, migration, or durable preference change is planned.

## Technical Context

**Language/Version**: TypeScript 5, React 19.2.8, Next.js 16.3.5; browser Media Capture, Canvas, WebGL/WASM

**Primary Dependencies**: Existing `livekit-client` 2.22.3, `@livekit/components-react` 2.9.24, Zustand 5, Astryx; add a pinned `@mediapipe/tasks-vision` release

**Storage**: No server/durable storage. Selection, runtime state, and custom images are participant-local and temporary. Existing `loft.room.media` session key remains unchanged for compatibility.

**Testing**: Vitest 5; lint, TypeScript, production build; real Chrome desktop two-peer testing; Chrome Android and Safari iOS where available; resource/network inspection

**Target Platform**: Current secure-context desktop/mobile browsers. Unsupported effects retain raw camera.

**Project Type**: Existing web app; this feature is frontend-only

**Performance Goals**: Effects-off has zero vision initialization/loop; High targets 30 fps, Medium 20–24 fps, Low 12–15 fps; cached activation under 2 seconds; no concurrent inference per capability; latest selection wins 100 rapid-switch runs

**Constraints**: Audio > camera > effects; one publication/processor/compositor; at most one segmentation and landmark inference in flight; no server media/state; no audio/screen processing; raw fallback

**Scale/Scope**: One local sender pipeline per room session; 3 Backgrounds, 3 required Looks, 5 named AR choices plus None and one animated effect; remote behavior/room scale unchanged

## Constitution Check

*GATE: Passed before research and after design.*

| Gate | Evidence | Result |
|---|---|---|
| Source of truth | One local controller/store; LiveKit owns track state; no distributed effect state | PASS |
| Security/privacy | Constrained non-executable local images; no frames/landmarks/uploads | PASS |
| Media/control separation | Camera → local processor → LiveKit only | PASS |
| Mirroring | Canvas output unmirrored; existing local front-camera CSS mirror retained | PASS |
| Bounded/race-safe | Generations, serialized reconciliation, single-flight inference, idempotent cleanup | PASS |
| Snapshot/reconnect | Existing room recovery unchanged; processor reconciles current SDK track | PASS |
| Extend before replace | Existing `LiveMediaContext`, `LocalVideoTrack`, Stage, errors, and UI store extended | PASS |
| Verification | Unit, lifecycle, build, two-peer, fallback, privacy, and leak checks defined | PASS |
| Stage-first UI | Compact camera popover/mobile sheet; no permanent sidebar | PASS |

No violation or exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/004-video-effects-pipeline/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── effects-ui.md
│   └── processor-lifecycle.md
└── tasks.md                 # later: $speckit-tasks
```

### Source Code (repository root)

```text
frontend/
├── public/effects/{models,ar}/
└── src/
    ├── components/room/VideoEffectsPanel.tsx
    ├── features/room/
    │   ├── RoomSession.tsx
    │   ├── RoomView.tsx
    │   └── effects/
    │       ├── contracts.ts
    │       ├── effectCatalog.ts
    │       ├── effectCapabilities.ts
    │       ├── effectController.ts
    │       ├── effectProcessor.ts
    │       ├── compositor.ts
    │       ├── mediaPipeRuntime.ts
    │       ├── customBackground.ts
    │       └── performanceMonitor.ts
    ├── stores/useVideoEffectsStore.ts
    └── lib/i18n/{dictionaries,types.ts,uiText.ts}

docs/{media-processing.md,video-effects.md,livekit.md,testing-strategy.md}
```

**Structure Decision**: Keep work in the frontend. `LiveMediaContext` remains the sole integration owner because it already owns `localParticipant`, toggles, reconnect, errors, and room cleanup. Pure effects logic lives under `features/room/effects`; the store contains desired/runtime presentation state but never manipulates tracks. Backend/protocols remain unchanged.

## Phase 0: Research Decisions

See [research.md](./research.md). Decisions:

1. Use installed LiveKit `LocalVideoTrack.setProcessor()` / `stopProcessor()` so sender replacement and simulcast remain SDK-owned.
2. Use one MediaPipe Tasks Vision runtime for segmentation and landmarks; do not add Jeeliz initially.
3. Use one `HTMLCanvasElement` output for `captureStream()`; optional offscreen working surface only.
4. Use monotonic generations, abortable loaders, serialized lifecycle operations, and single-flight inference.
5. Self-host pinned WASM/models/assets only after provenance/license notices are recorded.
6. Custom images: JPEG/PNG/WebP, ≤8 MiB encoded and ≤4096×4096 decoded; reject SVG/animated formats.

## Phase 1: Design

### Runtime ownership and graph

`LiveMediaContext` creates one controller for the mounted LiveKit room and destroys it before provider teardown. It observes the existing camera publication, attaches one processor only when needed, and calls `stopProcessor()` for raw fallback without toggling Room, camera, or mic.

```text
raw LocalVideoTrack
 ├─ effectively off ─────────────────────────► LiveKit raw sender
 └─ processing needed
      ├─ segmentation only for Blur/Custom
      ├─ landmarks only for AR
      ├─ color only for Warm/B&W
      └─ one unmirrored canvas output ───────► LiveKit sender replacement
```

LiveKit supplies the source element. Use `requestVideoFrameCallback` when available and bounded RAF fallback. Each expensive capability is single-flight; busy frames reuse a bounded recent result or skip, never queue.

### Latest-wins reconciliation

Every selection, camera source, visibility, reconnect, or disposal change increments `generation`. Reconciliation captures it and checks generation/source/owner after every await. Stale operations clean only their own resources and cannot attach tracks or report active. Lifecycle mutations run through one serialized promise chain; fetch/decode is aborted where possible. In-place config snapshots handle ordinary switches; attach/detach is reserved for raw↔processed, source replacement, and unrecoverable fallback.

### Lifecycle and failure isolation

- Camera OFF: preserve desired config; destroy processor/output; LiveKit owns raw source.
- Camera ON: wait for current publication and reconcile latest generation once.
- Device restart/switch: use processor `restart`; if SDK exposes a new local track, transfer ownership once.
- Reconnect/foreground: reconcile current publication identity; never publish a second track.
- Leave/unmount: mark disposed, increment generation, abort loads, stop loops/output, close tasks, revoke URLs, remove canvas/listeners, then allow existing disconnect.
- Capability failure: mark only that capability unavailable and recompute healthy composition; return raw only if no processing remains.

### Performance tiers

| Tier | Output | Vision cadence | Composition |
|---|---:|---:|---|
| High | ≤1280×720 @30 | ≤30 fps | Background + Look + AR |
| Medium | ≤960×540 @20–24 | 15–20 fps | Full, reduced animation |
| Low | ≤640×360 @12–15 | 8–10 fps | Background or AR + Look |
| Off | existing raw | 0 | None |

Use bounded rolling timings and skipped-frame ratios. Step down only after sustained pressure; step up after a stable window; at most one tier change per 15 seconds. Two consecutive unrecoverable errors open a session circuit for that capability. LiveKit retains network policy authority.

### Custom image and UI

Validate MIME plus browser decode for JPEG/PNG/WebP. Reject >8 MiB, dimensions >4096, SVG, and animated formats. Draw decoded pixels only, downscale to output, never show paths, and revoke prior URLs on replace/cancel/disable/destroy.

Keep the camera button's primary toggle. Add an adjacent effects disclosure: desktop popover, mobile bottom sheet. Groups: Background, Looks, Fun. One self-view reports actual status. Escape closes without disabling; focus returns to trigger; reduced motion suppresses decorative/animated motion. Selection is silent.

### Verification strategy

- Unit: normalization, capability derivation, generations, single-flight, tiers, isolation, image limits, cleanup.
- Fake-track controller: attach/update/stop/restart, stale completion, camera on/off, source replacement, reconnect, partial failure.
- UI/store: accessible groups/status, keyboard/touch/focus, reduced motion, no persistence.
- Existing tests, lint, TypeScript, production build.
- Manual two-peer: all effects/combinations, local/remote orientation, screen/mic isolation, device switch, reconnect, lifecycle, weak-device fallback, invalid images, context loss, resource stabilization.
- Privacy: no frames, masks, landmarks, image bytes, or effect events in app HTTP/WebSocket traffic.

## Contracts

- [Effects UI](./contracts/effects-ui.md)
- [Processor lifecycle](./contracts/processor-lifecycle.md)

## Post-Design Constitution Re-check

All gates still pass: one local bounded owner, latest-generation authority, raw fallback, SDK-owned sender replacement, presentation-only mirroring, and no backend state. No new exception exists.

## Complexity Tracking

No constitution violations or exceptional complexity.
