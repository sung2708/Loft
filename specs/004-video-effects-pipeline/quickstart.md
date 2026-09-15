# Quickstart Validation: Video Effects Pipeline

Validates [SPEC 004](./spec.md), the [UI contract](./contracts/effects-ui.md), and [processor lifecycle](./contracts/processor-lifecycle.md).

## Prerequisites

- Repository-supported Node/pnpm and installed frontend dependencies.
- Working backend/LiveKit and two room identities.
- HTTPS or localhost secure media context.
- Chrome desktop camera/mic plus a second browser/device; Chrome Android and Safari iOS where available.

## Automated checks

From `frontend/`:

```powershell
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

All must pass, including existing SPEC 001–003/media checks.

## Manual scenarios

### 1. Raw and lazy path

Join, enable camera without effects, then toggle mic/screen. Expect no vision model/WASM request, one raw camera publication, and independent audio/screen behavior.

### 2. Background/image safety

Test Blur→None, valid JPEG/PNG/WebP, replacement A→B→None, SVG, corrupt, >8 MiB, and >4096². Expect remote processing for valid inputs, safe rejection, no upload/path exposure, segmentation stopped on None, and released URLs/resources.

### 3. Conditional composition

Test Natural, Warm, B&W, each AR, and Blur+Warm+Glasses. Expect: Natural raw when alone; Looks start no detector; AR starts landmarks only; Blur starts segmentation only; combined mode has one compositor/publication.

### 4. Latest wins

Throttle model requests and run `Blur → None → Glasses → Cat ears → None`. Repeat 100 times in controller tests. Final state must be None with no stale activation or resource growth.

### 5. Orientation/isolation

Use readable text with front camera+Glasses, observe local/remote, flip rear, then screen-share with Blur selected. Local front is mirrored; remote/rear/screen are unmirrored; AR aligns; screen and mic remain untouched.

### 6. Lifecycle/leaks

Repeat 20 cycles: camera on → Blur → Glasses → off/on → None → camera switch → reconnect → background/foreground → leave/rejoin. Expect one publication when on, none when off/left, no stale processor, and stable tracks/tasks/listeners/URLs/canvases/heap.

### 7. Failure/degradation

Simulate model fetch/runtime failure, decode failure, context loss, and slow frames. Expect isolated capability failure; High→Medium→Low→Off without oscillation; raw camera and mic survive; no infinite retries.

### 8. Privacy

Inspect HTTP/WebSocket traffic while using all effects/custom image. No frames, image bytes, masks, landmarks, biometric geometry, or effect events may reach Mingly services.

## Recording results

Record browser, OS, device, scenario, fallback tier, and unavailable capability. Mark any unexecuted browser/device case **NOT VERIFIED**, never PASS.
