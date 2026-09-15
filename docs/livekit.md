# LiveKit SFU & WebRTC Media Architecture — Loft

This document specifies the WebRTC media plane architecture, token minting contract, and **MVP 2 optimization strategy** for Loft's LiveKit integration.

---

## 1. WebRTC & Media Transport Boundary

LiveKit serves as the dedicated Selective Forwarding Unit (SFU) for Loft.
1. **Zero Media via WebSocket:** The Go backend and its WebSocket connections **never** transport Opus audio frames, H.264/VP8 video streams, or screen-share pixels. All realtime media flows peer-to-server via WebRTC directly to the LiveKit SFU.
2. **Control vs. Media Plane Separation:** The Go backend controls authentication, room lifecycle, and token minting; LiveKit manages RTP track ingestion, simulcast distribution, and client bandwidth adaptation.

```
+-------------------------------------------------------------------------------+
|                                  REACT CLIENT                                 |
+-----------------------+-------------------------------+-----------------------+
                        |                               |
       WebSocket        |                               | WebRTC Media
       (Control Plane)  |                               | (Audio/Video/Screen)
                        v                               v
            +-----------------------+       +-----------------------+
            |      GO MONOLITH      |       |      LIVEKIT SFU      |
            | - Issues Scoped JWT   |       | - Ingests RTP Streams |
            | - Validates Bans/Roles|       | - Forwards Tracks     |
            | - Enforces Permissions|       | - Active Speaker Det. |
            +-----------+-----------+       +-----------------------+
```

---

## 2. Token Minting Implementation (Actual Code vs Target)

### Current Token Implementation (`backend/internal/livekit/token.go`)
- Tokens are minted using standard JWT library `github.com/golang-jwt/jwt/v5` with HMAC-SHA256 (`LIVEKIT_API_SECRET`).
- Token subject uses canonical prefix: `identity.LiveKitIdentity()` = `"user:<uuid>"` or `"guest:<uuid>"`.
- Video grant claims specify:
  ```json
  {
    "roomJoin": true,
    "room": "<room_id>",
    "canPublish": true,
    "canSubscribe": true,
    "canPublishData": true,
    "canPublishSources": ["microphone", "camera", "screen_share", "screen_share_audio"]
  }
  ```
- Grants are minted after the Go Hub confirms WebSocket admission. The JWT is short-lived; room bans block both future Loft admission and future token requests. LiveKit Cloud can revoke an active token through the management API; self-hosted LiveKit may keep an already issued JWT valid until expiry.

---

## 3. Current Client Configuration (MVP 2)

In `frontend/src/features/room/RoomSession.tsx`:
```tsx
<LiveKitRoom
  token={liveKitToken}
  serverUrl={LIVEKIT_URL}
  connect
  audio={false}
  video={false}
  options={{
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 30 } },
    publishDefaults: { simulcast: true, degradationPreference: "maintain-framerate" },
  }}
  onError={(error) => setMediaError(formatMediaError(error, "general"))}
  onMediaDeviceFailure={(failure) => setMediaError(formatDeviceFailure(failure))}
>
  <LiveMediaContext ... />
  <RoomAudioRenderer />
</LiveKitRoom>
```
- Media tracks are rendered using `<VideoTrack trackRef={camera} className="w-full h-full object-cover" />`.
- Local track publishing is initiated imperatively via `localParticipant.setCameraEnabled(true)` and `setMicrophoneEnabled(true)` based on preferences saved in `sessionStorage`.

---

## 4. MVP 2 Optimization Strategy

The following WebRTC optimizations are implemented in **MVP 2.3**:

### A. Adaptive Stream & Dynacast
- **Adaptive Stream (`adaptiveStream: true`)**:
  - Automatically manages track subscription quality based on the actual rendered pixel dimensions of the `<video>` element in the DOM.
  - When enabled in `<LiveKitRoom options={{ adaptiveStream: true }}>`, LiveKit client requests lower resolution layers when a video tile is small.
- **Dynacast (`dynacast: true`)**:
  - Directs publishing clients to pause video layers when no remote participant is actively subscribing to that layer, drastically cutting uplink CPU and bandwidth.

### B. Viewport- & Layout-Aware Subscriptions
Loft's `MediaStage` dynamically shifts between layouts (`grid`, `solo`, `screen-share`):

| Participant Visual State | Subscription Quality | Target Resolution | Target Bitrate |
| :--- | :---: | :---: | :---: |
| **Stage Solo / Active Presenter** | **HIGH** | 1280x720 @ 30fps | ~1,200 kbps |
| **Grid Tile (2–4 participants)** | **MEDIUM** | 640x360 @ 24fps | ~450 kbps |
| **Compact Strip (Screen share active)** | **LOW** | 320x180 @ 15fps | ~120 kbps |
| **Drawer / Tab Hidden Participant** | **PAUSED** | Layer paused | 0 kbps |

- **Implementation**: `MediaStage` uses `useTracks` with `{ onlySubscribed: false }`; LiveKit's adaptive stream observes rendered video element sizes and chooses the appropriate simulcast layer. The stage switches between solo, grid, and compact screen-share layouts.

### C. Screen Share Optimization
- **Text Sharpness & Detail**:
  ```typescript
  localParticipant.setScreenShareEnabled(true, {
    contentHint: "detail",
    resolution: { width: 1920, height: 1080, frameRate: 15 }
  });
  ```
- **Prioritization**: In LiveKit, screen share tracks are given high priority over webcam video so packet drops affect cameras before degrading screen clarity.

### D. Camera Resolutions & Framerates
- **Front Camera**: Preset to 720p at 30fps (optimal balance between quality and mobile thermal headroom).
- **Simulcast Layers**: Published with 3 spatial layers (High: 720p, Medium: 360p, Low: 180p).

### E. Connection Quality Monitoring
- Real-time quality indicators are rendered on each participant tile from LiveKit's `connectionQuality` value (`Excellent`, `Good`, `Poor`, `Unknown`) and mapped to bounded green/yellow/gray/red visual states.
