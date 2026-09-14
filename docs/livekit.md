# LiveKit SFU & WebRTC Media Architecture — Loft

## 1. WebRTC & Media Transport Boundary

LiveKit serves as the dedicated Selective Forwarding Unit (SFU) for Loft.
1. **Zero Media via WebSocket:** The Go backend and its WebSocket connections **never** transport Opus audio frames, H.264/VP8 video streams, or screen-share pixels. All realtime media flows peer-to-server via WebRTC directly to the LiveKit SFU.
2. **Control vs. Media Plane Separation:** The Go backend controls authorization, access grants, and presence tracking; LiveKit manages RTP track ingestion, simulcast switching, and client bandwidth adaptation.

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
            +-----------+-----------+       +-----------+-----------+
                        |                               |
                        | LiveKit Webhooks (Signed)     |
                        +◄──────────────────────────────+
                          (participant_joined, track_published)
```

---

## 2. Mapping Entity Identifiers

To maintain clean correlation across domain and media layers:

| Loft Concept | LiveKit SFU Entity | Identifier Format |
| :--- | :--- | :--- |
| **Room** | LiveKit Room | `room.id` (e.g. `c73d9e84-1b72-4d26-9f4a-71829e81b674`) |
| **User / Guest** | LiveKit Participant Identity | `user.id` (e.g. `8a4f21b8-6c3e-4d05-9271-93e5a2c418f2`) |
| **Display Name** | Participant Name | `user.display_name` |
| **Metadata** | Participant Metadata | JSON: `{ "role": "host", "avatar_url": "..." }` |
| **Mic Track** | Audio Track | `TrackSource: MICROPHONE` |
| **Camera Track**| Video Track | `TrackSource: CAMERA` |
| **Screen Track**| Screen Share Video Track | `TrackSource: SCREEN_SHARE` |
| **Tab Audio** | Screen Share Audio Track | `TrackSource: SCREEN_SHARE_AUDIO` |

---

## 3. Cryptographic Token Minting in Go

The frontend **never** receives the `LIVEKIT_API_SECRET`. The Go backend mints short-lived, permission-scoped tokens using `github.com/livekit/protocol/auth`:

```go
func (s *LiveKitService) CreateRoomToken(
    ctx context.Context,
    actor *Subject,
    room *RoomState,
) (string, error) {
    // 1. Centralized capability evaluation
    canPublishAudio := true
    canPublishVideo := true
    canPublishScreen := s.perms.CanShareScreen(actor, room)

    // 2. Build LiveKit video grant
    at := auth.NewAccessToken(s.apiKey, s.apiSecret)
    grant := &auth.VideoGrant{
        RoomJoin:             true,
        Room:                 room.RoomID.String(),
        CanPublish:           &canPublishAudio,
        CanPublishData:       &canPublishAudio,
        CanSubscribe:         &[]bool{true}[0],
    }

    if !canPublishScreen {
        grant.CanPublishSources = []livekit.TrackSource{
            livekit.TrackSource_MICROPHONE,
            livekit.TrackSource_CAMERA,
        }
    }

    at.AddGrant(grant).
        SetIdentity(actor.ID.String()).
        SetName(actor.DisplayName).
        SetValidFor(2 * time.Hour)

    return at.ToJWT()
}
```

---

## 4. Screen Sharing Architecture & Constraints

Screen sharing leverages the standard Web API `navigator.mediaDevices.getDisplayMedia()`:
1. **Platform Picker:** The browser manages the native OS window/screen selection modal. The application cannot enumerate unauthorized private windows directly.
2. **Audio Capture:** Where supported by the browser and operating system (e.g. Chrome on Windows/macOS), the user may toggle "Share tab audio" or "Share system audio". This generates a secondary audio track (`SCREEN_SHARE_AUDIO`).
3. **Application Control Broadcast:** When a user initiates or stops screen sharing, their client notifies the Go backend via `screen.started` / `screen.stopped`. The Go backend updates `RoomState.ActiveShare` and broadcasts the layout change to all room subscribers.

---

## 5. LiveKit Webhooks & Reconciliation

LiveKit notifies the Go backend of media lifecycle events via HTTP POST to `/api/v1/webhooks/livekit`:
- **Security Check:** Webhook requests are verified using LiveKit's cryptographic signature header (`auth.VerifyWebhook(req, apiKey, apiSecret)`).
- **Track Lifecycle Handling:**
  - `participant_left`: If a participant disconnects unexpectedly from LiveKit, Go checks if their WebSocket is also dead.
  - `track_published` / `track_unpublished`: Updates the active speaker and presenter state in the in-memory `RoomActor`.
