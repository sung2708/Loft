# Skill: Video Effects & Client-Side Media Processing

## WHEN TO USE THIS SKILL
Use this skill when implementing, modifying, or debugging client-side video processing, camera orientation, mirroring, MediaPipe face landmarks, background blur/replacement, or track publishing to LiveKit.

## SOURCE OF TRUTH
- **Physical Media**: Raw camera `MediaStreamTrack` from `navigator.mediaDevices.getUserMedia()`.
- **Effect Configuration**: Client-local state (`VideoEffectConfig` in `useUIStore` or dedicated effects store). Never synchronized to backend.
- **Published Track**: Local video publication in LiveKit SFU (`localParticipant.videoTrackPublications`).

## ARCHITECTURAL BOUNDARIES
- Vision processing executes strictly in the user's browser via `@mediapipe/tasks-vision` (WASM/SIMD) and Canvas.
- The Go backend and WebSocket protocol **never** receive, process, or proxy video frames.
- Screen-share tracks bypass the video effects processor entirely and are never altered.

## REQUIRED WORKFLOW
1. **Inspect Camera & Facing Mode**:
   - Query `track.getSettings().facingMode`.
   - Determine if stream is front camera (`"user"`), rear camera (`"environment"`), or screen share.
2. **Apply Mirroring Separation**:
   - Front camera self-preview: Apply `transform: scaleX(-1)` strictly to local preview element.
   - Published track & remote tiles: Render unmirrored (`transform: none`).
   - Rear camera & screen share: Never apply scale inversion.
3. **Initialize MediaPipe Lazily**:
   - Fetch `selfie_segmenter.tflite` or `face_landmarker.task` only upon first effect enablement.
   - Setup `OffscreenCanvas` and 2D/WebGL rendering pipeline.
4. **Pipe to LiveKit Without Tree Remount**:
   - Capture processed stream via `canvas.captureStream(fps)`.
   - Swap the published track in LiveKit using `localParticipant.switchProvider()` or in-place track replacement.
   - Never cause unmounting or remounting of `RoomSession` or participant tile components.
5. **Handle Tab Backgrounding & Teardown**:
   - Listen for `visibilitychange`; pause inference when tab is hidden (`document.hidden`).
   - On effect disable (`"none"`), stop canvas loop and revert LiveKit to raw camera track.

## IMPLEMENTATION RULES
- Enforce the golden degradation rule: **Audio stability > Camera stability > Filter quality**.
- Profile frame durations. If frame render takes $>25\text{ms}$ consistently, step down quality tier (`HIGH` → `MEDIUM` → `LOW` → `OFF`).
- Always catch WASM execution exceptions inside the frame loop; if inference throws twice consecutively, trip circuit breaker and revert to raw camera passthrough with user notification.

## FAILURE CASES
- **WASM Load Failure**: Revert silently to raw camera passthrough; log warning.
- **Context Loss**: Recreate canvas and 2D context; do not crash the call.
- **Camera Permission Revoked**: LiveKit `onMediaDeviceFailure` handles UI notification; reset effect state.

## TEST REQUIREMENTS
- **Automated**: Vitest tests verifying `VideoEffectConfig` state transitions and tier step-down logic.
- **Real-Browser Physical Test**:
  1. Hold printed text up to front camera: local view is mirrored, remote peer reads text unmirrored.
  2. Switch to rear camera: preview is unmirrored.
  3. Turn on screen share: text is razor sharp and never mirrored.
  4. Toggle effect ON/OFF 5 times: no WebRTC renegotiation drops, audio remains uninterrupted.

## DO NOT
- DO NOT process or decode video frames on the Go backend.
- DO NOT apply `transform: scaleX(-1)` globally to video tags or to published remote streams.
- DO NOT mirror screen-share tracks under any circumstance.
- DO NOT remount the React participant tree when switching effects.
- DO NOT install heavy, unvetted plugin frameworks.

## DONE WHEN
- Local self-preview is naturally mirrored while remote participants see unmirrored video.
- Background blur and face filter toggle smoothly without audio stutter.
- Tab backgrounding pauses vision inference cleanly.
- Quality degrades gracefully under simulated CPU load.
