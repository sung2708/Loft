# Skill: LiveKit WebRTC Integration & Token Minting

## Trigger
Use this skill whenever modifying LiveKit token generation, video/audio grants, screen share track permissions, LiveKit server webhooks, or WebRTC client connection handshakes.

## Goals
- Maintain strict boundary between LiveKit SFU media transport and Go application control plane.
- Ensure `LIVEKIT_API_SECRET` is never exposed or delivered to the client.
- Generate cryptographically scoped tokens enforcing room-level permissions.

## Required reading
- [livekit.md](file:///d:/git/Loft/docs/livekit.md)
- [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md)
- [auth-and-permissions.md](file:///d:/git/Loft/docs/auth-and-permissions.md)

## Source of truth
- WebRTC track routing and active streams belong to LiveKit SFU.
- Permission grants and token signing belong to Go `internal/livekit/token.go`.

## Invariants
- Application WebSocket must **never** route raw audio/video frames or screen-share streams.
- LiveKit tokens must have short expirations (max 2 hours) and room-scoped video grants.
- Screen sharing permission (`CanShareScreen`) must be checked before granting `CanPublishSources: [SCREEN_SHARE]`.
- All incoming webhooks from LiveKit must be cryptographically verified using `auth.VerifyWebhook`.

## Workflow
1. When user joins room or requests media token: evaluate user permissions.
2. Construct `auth.VideoGrant` with explicitly permitted track sources.
3. Sign JWT using `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
4. Deliver token to client via REST `GET /api/v1/rooms/{id}/livekit-token` or inside `room.snapshot`.
5. For webhooks: parse payload, verify signature, and update active speaker / presenter state.

## Implementation rules
- **WHAT TO DO:** Restrict participant grants based on domain evaluation (`can_share_screen`).
- **WHAT NOT TO DO:** Never grant wildcard admin permissions (`RoomAdmin: true`) to client tokens.
- **WHY:** Granting admin permissions allows a malicious client to kick participants directly at the SFU layer, bypassing Go business authority.
- **HOW TO VERIFY IT:** Inspect minted JWT claims using a JWT decoder.

## Failure cases
- If LiveKit SFU is down, token requests fail gracefully; the client renders a voice reconnection badge while chat and shared media remain operational.

## Security considerations
- Keep `LIVEKIT_API_SECRET` strictly in backend environment variables.
- Verify webhook `Authorization` header on `/api/v1/webhooks/livekit` before processing.

## Testing
- Unit test token generator claims and expiration.
- Test that unauthorized members (e.g. guests without screen permission) receive tokens without screen-publishing grants.

## Verification
- Generated token decodes to valid claims matching the user's identity and room ID.
- Webhook endpoint rejects unsigned payloads with HTTP 401.

## Common mistakes
- Attempting to pass audio packets over the Go WebSocket connection.
- Omitting room ID in the video grant, allowing a token to join any room on the LiveKit server.

## Completion report
Upon finishing changes, summarize:
1. Video grant modifications and permission bindings.
2. Webhook handler adjustments and signature validation.
3. Token verification test output.
