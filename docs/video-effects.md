# Video Effects Architecture & Performance Strategy — Loft

This document defines Mingly's client-side video effects model, lifecycle management, and tiered performance degradation strategy for **MVP 3 / SPEC 004**. The raw MVP2 camera path remains the default and fallback.

The implemented integration extends the existing LiveKit `LocalVideoTrack` with one SDK `TrackProcessor`; it does not unpublish/re-publish the camera or create a second Room. MediaPipe Tasks Vision is loaded lazily from same-origin assets for segmentation and face landmarks. Looks and procedural 2D AR overlays share one unmirrored canvas compositor. Microphone and screen-share tracks never enter this pipeline.

---

## 1. Minimal Effect Configuration Model

Loft intentionally avoids massive third-party plugin frameworks in favor of a lean, strongly typed configuration model:

```typescript
export type BackgroundEffectType = "none" | "blur" | "image";

export type FaceEffectType =
  | "none"
  | "sunglasses"     // 2D accessory anchored to eyes/nose bridge
  | "bunny_ears"     // 2D accessory anchored to top of forehead
  | "cyber_mesh";    // Subtle neon wireframe overlay on facial mesh

export interface VideoEffectConfig {
  mirrorPreview: boolean;               // Mirrored local preview for front camera
  backgroundEffect: BackgroundEffectType;
  backgroundImageUrl?: string;          // Preset URL when backgroundEffect === "image"
  blurRadius: number;                   // Blur intensity (default: 12px)
  faceEffect: FaceEffectType;
}

export const defaultVideoEffectConfig: VideoEffectConfig = {
  mirrorPreview: true,
  backgroundEffect: "none",
  blurRadius: 12,
  faceEffect: "none",
};
```

---

## 2. Processor Lifecycle & LiveKit Integration

### Zero-Remount Track Replacement
**Critical Invariant:** Enabling, disabling, or switching a video effect must **never** unmount or remount the RoomSession component, the ParticipantMediaTile tree, or LiveKit's WebRTC connection.

```
       [ Toggle Effect in UI ]
                  │
                  ▼
       [ Update EffectConfig ]
                  │
                  ├──────────────────────────────┐
                  ▼                              ▼
     (If effect was OFF -> ON)       (If effect was ON -> SWITCH)
  1. Initialize VideoProcessor       1. Update internal render mode
  2. Capture canvas.captureStream()  2. Continuous frame delivery
  3. LocalVideoTrack.setProcessor()
     (LiveKit replaces sender tracks in-place)
```

### Lifecycle State Machine

1. **Initialization**:
   - Model weights (`selfie_segmenter.tflite`, `face_landmarker.task`) are fetched and compiled into WASM modules lazily upon first effect activation, never blocking page load.
   - Reusable `OffscreenCanvas` and 2D contexts are instantiated.

2. **Enabling an Effect**:
   - The processor starts an internal `requestAnimationFrame` loop.
   - The processed `MediaStreamTrack` replaces the sender through LiveKit's processor lifecycle while preserving the camera publication and simulcast senders.

3. **Disabling an Effect (`none`)**:
   - The processor terminates its `requestAnimationFrame` loop.
   - `LocalVideoTrack.stopProcessor()` restores the raw camera `MediaStreamTrack`.
   - CPU/GPU inference drops immediately to zero.

4. **Tab Backgrounding / Visibility Change**:
   - When the user switches tabs (`document.hidden === true`):
     - Vision ML inference is paused immediately to conserve CPU/battery.
     - The output track continues outputting the last rendered frame or falls back to black/low-rate passthrough.
   - When the tab returns to foreground (`visibilitychange`):
     - Inference resumes seamlessly without track renegotiation.

5. **Camera Restart & Device Switch**:
   - If the user changes camera hardware, the new raw track is assigned to the processor's input video element; the canvas pipeline continues rendering to the same output track.

6. **Cleanup on Room Exit**:
   - All `MediaStreamTrack` instances are called with `.stop()`.
   - WebAssembly models and canvas contexts are dereferenced and garbage collected.

---

## 3. Tiered Performance Strategy

Video filters are purely aesthetic enhancements. They must never compromise the primary objective of a social hangout: clear, low-latency audio and stable video communication.

### The Golden Reliability Hierarchy

$$\mathbf{Audio\ Stability} > \mathbf{Camera\ Stability} > \mathbf{Filter\ Quality}$$

If device hardware or thermal constraints create pressure, the system degrades effects aggressively before allowing audio stutter or WebRTC packet drop.

### Quality Tiers Specification

| Dimension | Tier 1: HIGH | Tier 2: MEDIUM | Tier 3: LOW | Tier 4: OFF |
| :--- | :---: | :---: | :---: | :---: |
| **Target Hardware** | Modern Laptops, High-end Desktops | Mid-range Laptops, Recent Tablets | Low-end Laptops, Mobile Devices | Thermal/CPU Pressure, Battery Saver |
| **Input Resolution** | 960x540 (qHD) | 640x360 (360p) | 480x270 | Lightweight passthrough |
| **Inference FPS** | 15 FPS | 10 FPS | 6 FPS (last-result reuse) | 0 (Disabled) |
| **Output FPS** | 30 FPS | 24 FPS | 15 FPS | Native Camera FPS |
| **Supported Effects** | All (Blur, Image, Face) | Blur, Image, Single Face | Background Blur Only | None (Passthrough) |
| **Compositing** | Feathered edge mask | Soft boundary box mask | Low-radius box blur | Direct camera stream |

---

## 4. Adaptive Degradation Engine

The client monitors performance metrics in real-time to trigger automatic tier step-downs:

```typescript
class EffectPerformanceMonitor {
  private frameTimes: number[] = [];
  private droppedFrames = 0;

  recordFrame(renderDurationMs: number) {
    this.frameTimes.push(renderDurationMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    const avgDuration = this.average(this.frameTimes);

    // If frame processing takes > 25ms consistently (> 75% of 33ms budget at 30fps)
    if (avgDuration > 25) {
      this.triggerStepDown("Render budget exceeded");
    }
  }

  private triggerStepDown(reason: string) {
    console.warn(`[Loft Video] Downgrading effect tier: ${reason}`);
    // Step down: HIGH -> MEDIUM -> LOW -> OFF
  }
}
```

### Degradation Rules:
1. **CPU/GPU Pressure**: If average render time exceeds 25ms over 3 consecutive seconds, automatically step down one quality tier.
2. **Thermal / Battery Saver**: If `navigator.getBattery()` indicates low power mode or battery $<15\%$, cap tier to `LOW` or `OFF`.
3. **WebRTC Congestion**: If LiveKit reports high uplink packet loss ($>8\%$), effect resolution is reduced immediately to reduce encoder bitrate.
4. **Crash Circuit Breaker**: If MediaPipe throws two consecutive WASM exceptions, effects are disabled (`OFF`) for the remainder of the session, and a non-intrusive toast informs the user: *"Camera effects disabled to keep call smooth"*.

When background segmentation and face landmarks are both required, their inference calls alternate between eligible video frames. MediaPipe's web inference APIs are synchronous, so this bounds main-thread stalls instead of running both models in one frame. Repeated animation frames for the same decoded video frame never trigger duplicate inference.

---

## 5. Related Documentation
- [Client-Side Media Processing Pipeline](file:///d:/git/Loft/docs/media-processing.md)
- [LiveKit WebRTC Integration & Optimization](file:///d:/git/Loft/docs/livekit.md)
- [Testing Strategy & Quality Assurance](file:///d:/git/Loft/docs/testing-strategy.md)
- [ADR-007: Client-Side Video Effects](file:///d:/git/Loft/docs/adr/README.md#adr-007-client-side-video-effects-via-mediapipe--offscreencanvas)
- [ADR-010: Camera Mirroring Separation](file:///d:/git/Loft/docs/adr/README.md#adr-010-camera-mirroring-separation-preview-vs-published-track)
