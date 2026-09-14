# Client-Side Media Processing Pipeline — Loft

This document specifies the architecture, data flow, and invariants for Loft's client-side video processing pipeline, addressing camera orientation, mirroring correctness, and real-time vision effects.

---

## 1. High-Level Pipeline Architecture

The video processing pipeline operates entirely within the user's browser, transforming raw camera frames into an enriched video track before publishing to the LiveKit SFU:

```
                      [ Physical Camera ]
                              │
                              ▼ (getUserMedia)
                  [ Browser MediaStreamTrack ]
                              │
                              ▼
                 ┌─────────────────────────┐
                 │     VIDEO PROCESSOR     │
                 │ ─────────────────────── │
                 │ 1. Frame Capture        │
                 │ 2. Mirror Decision      │
                 │ 3. Face Landmarker      │
                 │ 4. Background Segmenter │
                 │ 5. Canvas Compositing   │
                 └────────────┬────────────┘
                              │
               ┌──────────────┴──────────────┐
               │                             │
               ▼                             ▼
    [ Local Self-Preview ]        [ Processed Video Track ]
    (Mirrored for front cam)      (Canvas.captureStream)
    (Natural user reflection)                │
                                             ▼
                                     [ LiveKit SFU ]
                                     (Unmirrored published stream)
                                             │
                                             ▼
                                  [ Remote Participants ]
                                  (See natural orientation)
```

---

## 2. The Mirroring Invariant Rules

Mirroring is the single most common source of UX failure in WebRTC applications. A user expects their self-view to behave like a bathroom mirror, but remote participants must see them as if standing in front of them (e.g. text on clothing, gestures, and books must not be reversed).

### Mirroring Specification Table

| Video Stream Type | Local Self-Preview | Published Track (LiveKit) | Remote Tile Rendering | Rationale |
| :--- | :---: | :---: | :---: | :--- |
| **Front Camera** (`user`) | **MIRRORED** | **UNMIRRORED** | **UNMIRRORED** | Local user gets natural mirror reflection; remote participants see readable text on user's clothing. |
| **Rear Camera** (`environment`) | **UNMIRRORED** | **UNMIRRORED** | **UNMIRRORED** | User points camera outward (scenery/document); mirroring would reverse physical reality. |
| **Screen Share** (`display`) | **UNMIRRORED** | **UNMIRRORED** | **UNMIRRORED** | Text, code, and interfaces become completely unreadable if mirrored. **Strictly forbidden.** |
| **Remote Peers' Camera** | N/A | N/A | **UNMIRRORED** | Local user always observes other participants in natural orientation. |

### Technical Implementation of Mirroring

1. **Local Preview Mirroring**:
   - Applied at the CSS presentation layer or during local canvas rendering:
     ```css
     /* Applied ONLY to local participant's front-camera preview element */
     .loft-local-preview[data-facing="user"] {
       transform: scaleX(-1);
     }
     ```
   - **Critical Rule:** Never apply `transform: scaleX(-1)` globally to `<VideoTrack />` components. It must be scoped strictly to `track.isLocal && track.source === Track.Source.Camera && facingMode === "user"`.

2. **Published Stream Integrity**:
   - The canvas compositing pipeline writes unmirrored frames to the output `MediaStreamTrack` produced by `canvas.captureStream(fps)`.
   - The published track sent over WebRTC to LiveKit retains normal orientation.

3. **Screen Share Protection**:
   - Screen tracks bypass the Video Processor entirely.
   - Screen tracks are published directly from `navigator.mediaDevices.getDisplayMedia()` without CSS or canvas transforms.

---

## 3. Camera Device Lifecycle & Facing Mode

### Facing Mode Detection
Modern devices (smartphones, tablets, laptops with dual cameras) expose facing modes via `MediaTrackSettings`:

```typescript
const track = stream.getVideoTracks()[0];
const settings = track.getSettings();
const facingMode: "user" | "environment" = settings.facingMode || "user";
```

### Device Switching Lifecycle
1. User selects a new video input device via the UI dropdown.
2. The pipeline stops the active source track cleanly:
   ```typescript
   activeStreamTrack.stop();
   ```
3. New `getUserMedia` constraints are acquired with explicit device ID:
   ```typescript
   const newStream = await navigator.mediaDevices.getUserMedia({
     video: { deviceId: { exact: newDeviceId } }
   });
   ```
4. The new `MediaStreamTrack` is piped into the existing Video Processor without remounting the React stage or interrupting audio tracks.
5. If effects are disabled, LiveKit's `localParticipant.switchProvider(newTrack)` updates the SFU track in-place.

---

## 4. Vision Processing: `@mediapipe/tasks-vision`

All ML inference executes client-side on the user's browser using WebAssembly and SIMD acceleration via Google MediaPipe.

### Technology Stack
- **Library**: `@mediapipe/tasks-vision`
- **Wasm Runtime**: Loaded asynchronously from public CDN or bundled assets (`/wasm/vision_wasm_internal.js`).
- **Models**:
  - Background Segmentation: `selfie_segmenter.tflite` (lightweight, ~250KB).
  - Face Landmarker: `face_landmarker.task` (sparse 468 3D landmarks, ~3.5MB).

### Compositing: Canvas 2D vs WebGL
- **Canvas 2D (Default MVP 2)**:
  - Simple, predictable across all browsers (including low-end mobile Chrome/Safari).
  - Uses `OffscreenCanvas` with `CanvasRenderingContext2D.drawImage()`, `globalCompositeOperation = "destination-in"` for masking, and `filter = "blur(12px)"`.
  - Zero shader compilation overhead.
- **WebGL (Performance Upgrade Path)**:
  - Evaluated only if Canvas 2D CPU frame times exceed 20ms during profiling.
  - Avoid premature WebGL complexity without benchmark evidence.

---

## 5. End-to-End Processing Loop

```typescript
function processFrame() {
  if (!isProcessingActive) return;

  const now = performance.now();
  if (now - lastFrameTime >= frameIntervalMs) {
    lastFrameTime = now;

    // 1. Grab camera frame
    ctx.drawImage(videoElement, 0, 0, width, height);

    // 2. Perform ML segmentation if background effect enabled
    if (effectConfig.backgroundEffect !== "none") {
      const mask = segmenter.segmentForVideo(videoElement, now);
      applyBackgroundEffect(ctx, mask, effectConfig.backgroundEffect);
    }

    // 3. Perform Face Landmarker if face effect enabled
    if (effectConfig.faceEffect !== "none") {
      const landmarks = faceLandmarker.detectForVideo(videoElement, now);
      applyFaceEffect(ctx, landmarks, effectConfig.faceEffect);
    }
  }

  requestAnimationFrame(processFrame);
}
```

---

## 6. Failure Recovery & Fallback Principles

1. **Model Loading Failure**: If MediaPipe models fail to load (e.g. offline, slow network, corrupted WASM), the processor logs a warning and falls back immediately to **raw camera passthrough**. The user's video must continue streaming.
2. **Context Loss**: If `OffscreenCanvas` context is lost, the processor re-initializes canvas resources without crashing the call.
3. **Permission Revocation**: If camera permissions are revoked mid-call, LiveKit's `onMediaDeviceFailure` handles UI notification and clears active track references.

---

## 7. Related Documentation
- [Video Effects Architecture](file:///d:/git/Loft/docs/video-effects.md)
- [LiveKit WebRTC Integration & Optimization](file:///d:/git/Loft/docs/livekit.md)
- [Testing Strategy & Quality Assurance](file:///d:/git/Loft/docs/testing-strategy.md)
- [ADR-007: Client-Side Video Effects](file:///d:/git/Loft/docs/adr/README.md#adr-007-client-side-video-effects-via-mediapipe--offscreencanvas)
- [ADR-010: Camera Mirroring Separation](file:///d:/git/Loft/docs/adr/README.md#adr-010-camera-mirroring-separation-preview-vs-published-track)
