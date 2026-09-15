# Research: Video Effects Pipeline

## 1. LiveKit processor integration

**Decision**: Implement one `TrackProcessor<Track.Kind.Video>` and use the current `LocalVideoTrack.setProcessor(processor, true)`, `restart`, and `stopProcessor()` lifecycle.

**Rationale**: Installed LiveKit 2.22.3 initializes/destroys processors, swaps the primary and simulcast sender tracks, and restores the raw source. This avoids black-frame camera toggles, unpublish/republish races, duplicate publications, and a second Room owner.

**Alternatives considered**: Manual camera off/on and republish (lifecycle/race risk); second Room/camera manager (architecture violation); CSS-only filters (not visible remotely).

**Evidence**: Installed SDK source and [LiveKit LocalVideoTrack reference](https://docs.livekit.io/reference/client-sdk-js/classes/LocalVideoTrack.html).

## 2. One MediaPipe vision runtime

**Decision**: Pin `@mediapipe/tasks-vision` for both person segmentation and face landmarks; render app-owned 2D AR assets from landmarks. Omit optional Cool initially.

**Rationale**: ADR-007 already accepts MediaPipe. One runtime avoids duplicate model loaders, camera acquisition, WebGL contexts, scheduling, and cleanup while meeting the required simple AR library.

**Alternatives considered**: Jeeliz + MediaPipe is Apache-2.0 and capable, but adds a second camera-oriented WebGL runtime; reconsider only if a measured prototype shows MediaPipe landmarks inadequate. Prebuilt background-only processors cannot compose the full graph.

**Evidence**: [MediaPipe repository](https://github.com/google-ai-edge/mediapipe), [Jeeliz FaceFilter](https://github.com/jeeliz/jeelizFaceFilter), and `docs/adr/README.md`.

## 3. Pinned same-origin assets

**Decision**: Lazy-load WASM, models, and AR images from versioned `/effects/` paths. Record source, version, hash, license, and notices before committing each binary/art asset.

**Rationale**: Same-origin delivery avoids CDN drift/outage/CSP/privacy issues and supports immutable caching. MediaPipe code is Apache-2.0, but every model and visual asset still needs explicit provenance review.

**Alternatives considered**: Runtime CDN (version/privacy/availability risk); initial JS bundle (penalizes non-users); unverified art/model downloads (licensing risk).

## 4. Canvas and bounded frame scheduling

**Decision**: One hidden `HTMLCanvasElement` produces the `captureStream()` output. An OffscreenCanvas may be a working surface only. Prefer `requestVideoFrameCallback`, use bounded RAF fallback, and allow one inference in flight per capability.

**Rationale**: One output gives deterministic Background → Look → AR ordering. Single-flight inference prevents frame backlog and leaves time for encoding/audio/UI.

**Alternatives considered**: OffscreenCanvas-only output (compatibility/capture limitation); WebGL-first shaders (premature); live thumbnail pipelines (unbounded waste).

## 5. Latest-generation authority

**Decision**: Increment a monotonic generation for selection/source/lifecycle changes; serialize track mutations; verify generation, source, and owner after every await; abort loads where possible.

**Rationale**: WASM initialization and image decode are not universally cancellable. Generation checks prevent stale completion, while serialization prevents overlapping attach/stop/restart.

**Alternatives considered**: UI debounce or AbortController alone cannot cover already-started non-abortable work; global locking is unnecessary for one local controller.

## 6. Degradation and failure isolation

**Decision**: Use High/Medium/Low/Off tiers, skip rather than queue frames, step down after sustained pressure, and open a session circuit after two consecutive unrecoverable capability failures. Step-up is slow with 15-second transition hysteresis.

**Rationale**: Optional processing competes with encoding and UI. Isolating segmentation and landmarks lets a healthy Look/Blur continue when AR fails and preserves audio > camera > effects.

**Alternatives considered**: Fixed 30/60 fps (unsafe on weak devices); disable everything on one failure (unnecessary loss); inference every frame (backlog risk).

## 7. Custom background limits

**Decision**: Accept JPEG, PNG, WebP; maximum 8 MiB encoded and 4096×4096 decoded; reject SVG and animated formats; downscale decoded pixels and deterministically revoke object URLs.

**Rationale**: Common photo coverage with bounded memory and no executable markup. A 4096² RGBA decode already consumes about 64 MiB before copies.

**Alternatives considered**: Any `image/*` (active/animated/inconsistent formats); no dimension cap (decode bomb risk); Supabase upload (privacy and SPEC 006 scope violation).

## 8. Orientation and browser support

**Decision**: Process unmirrored frames and keep current local front-camera CSS mirroring. Capability-test secure context, canvas capture, WASM, and graphics features; unsupported advanced effects fall back to raw camera.

**Rationale**: Remote text stays readable and rear/screen tracks stay natural. Capability checks age better than user-agent allowlists and preserve the camera on weak/unsupported devices.

**Alternatives considered**: Mirrored canvas output reverses remote video; browser allowlists miss GPU/device differences; blocking join violates optionality.
