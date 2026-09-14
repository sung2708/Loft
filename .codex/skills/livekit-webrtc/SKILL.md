# Skill: LiveKit WebRTC Integration & Optimization

## WHEN TO USE THIS SKILL
Use this skill when modifying LiveKit token issuance, video/audio track publishing, WebRTC connection options, adaptive stream subscriptions, simulcast layers, screen-share settings, or participant media rendering.

## SOURCE OF TRUTH
- **RTP Media Transport & Track State**: LiveKit SFU.
- **Permission Grants & Token Issuance**: Go backend (`internal/livekit/token.go`).
- **Rendered Track State**: `@livekit/components-react` hooks (`useTracks`, `useParticipants`).

## ARCHITECTURAL BOUNDARIES
- WebRTC media flows peer-to-SFU directly to LiveKit; the Go WebSocket layer **never** routes media packets.
- The client **never** receives `LIVEKIT_API_SECRET`.
- The Go backend manages token generation via REST endpoint `POST /api/v1/rooms/{id}/livekit-token` after WebSocket admission.

## REQUIRED WORKFLOW
1. **Token Minting**:
   - Evaluate user capabilities on the server (`CanJoin`, `CanShareScreen`).
   - Construct video grant claims using `golang-jwt/jwt/v5` signed with `LIVEKIT_API_SECRET`.
   - Set subject to `identity.LiveKitIdentity()` (`"user:<uuid>"` or `"guest:<uuid>"`).
2. **Client Media Connection**:
   - Request token via REST API only after WebSocket `room.snapshot` admission succeeds.
   - Mount `<LiveKitRoom>` with `adaptiveStream: true` and `dynacast: true`.
3. **Adaptive Subscription Optimization**:
   - Configure participant tiles with layout-aware subscription quality (low-bitrate for compact tiles, full 720p for solo/stage).
4. **Screen Share Configuration**:
   - Set `contentHint: "detail"`, 1080p resolution, and 15fps cap to prioritize text sharpness over motion smoothness.
5. **Device Lifecycle**:
   - Handle device switches in-place via `localParticipant.switchProvider()` without disconnecting from the SFU room.

## IMPLEMENTATION RULES
- Always check `can_share_screen` before adding `"screen_share"` to `CanPublishSources`.
- Do not claim a WebRTC optimization (simulcast, dynacast) is active until verified with browser WebRTC stats (`chrome://webrtc-internals`).
- Handle `onMediaDeviceFailure` to notify users gracefully without crashing the session.

## FAILURE CASES
- **LiveKit Outage**: Token request fails or WebRTC drops; UI displays media reconnection badge; WebSocket chat and shared media remain 100% operational.
- **Uplink Packet Loss**: Adaptive stream lowers published layer automatically; if severe, prompt user to disable camera.

## TEST REQUIREMENTS
- **Unit**: Verify token claims, expiration (max 2 hours), and room-scoped grants in Go tests.
- **Browser**: Verify small participant thumbnail receives low-bitrate layer ($<150\text{kbps}$); screen share preserves crisp 1080p IDE text.

## DO NOT
- DO NOT route audio or video packets through the Go WebSocket connection.
- DO NOT grant wildcard admin privileges (`RoomAdmin: true`) to client tokens.
- DO NOT disconnect and reconnect the entire WebRTC room session just to toggle microphone or camera.

## DONE WHEN
- LiveKit tokens are securely minted with strictly scoped room and participant claims.
- Video tiles adapt stream quality based on rendered size without visual stutter.
- Screen share renders crisp code text without mirroring.
- Audio and video survive transient network blips without tearing down the control plane.
