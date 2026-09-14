# Media Synchronization Engine — Loft

## Current MVP implementation (YouTube)

The room currently accepts HTTPS `youtube.com/watch`, `youtube.com/shorts`, and `youtu.be` links only. The Go WebSocket hub owns the in-memory current track, bounded 50-item queue, playback anchor, shared repeat setting, and monotonically increasing version. Every room snapshot includes this state; accepted mutations broadcast a full `media.state`. Host-only play/pause/seek/next/select/repeat commands carry `expected_version`, so concurrent Next clicks cannot skip multiple tracks from one version. Any joined participant may add or reorder queue items; parsing is local with no outbound fetch. Queue order is validated as an exact permutation of queued track IDs.

Playback bytes stay in each browser's official YouTube IFrame player. Each browser requires a user gesture to enable audio. The host player reports the current video's duration to the Go authority; Go schedules automatic repeat or queue advance at the canonical end, even if every browser stops playing or disconnects afterward. Without a host duration report, automatic advance is unavailable. The client performs hard seek when drift exceeds 1.5 seconds and estimates server clock offset from ping/pong. Queue/playback state is retained ten minutes after the last participant leaves, then evicted; it does **not** survive a Go process restart. Persistent media history and the finer three-tier drift algorithm below remain roadmap work.

Media commands are limited to 10 per 10 seconds per room identity; queue mutations are limited to 10 per minute. The server rejects excess commands with `MEDIA_RATE_LIMITED`.

Reactions use a separate ephemeral WebSocket event: six allowed emoji, four per connection and twenty per room per two-second window. Slow consumers may miss reactions without losing chat or media state.

## 1. Media Sync Philosophy & Legal Architecture

Loft enables social co-watching and listening without copyright infringement or bandwidth re-streaming:
1. **No Media Proxying:** The server **never** proxies, downloads, caches, or re-streams audio/video bytes from YouTube, Spotify, or SoundCloud.
2. **Client-Side Official SDKs:** Each client embeds the official provider player (YouTube IFrame API, Spotify Web Playback SDK, SoundCloud Widget API).
3. **Synchronized State Authority:** The Go backend synchronizes the canonical playback timeline, play/pause commands, and media queue mutations.

---

## 2. Canonical Playback State Model

```go
type MediaPlaybackState struct {
    Provider            MediaProvider `json:"provider"`              // "youtube" | "spotify" | "soundcloud"
    MediaID             string        `json:"media_id"`              // Provider-specific content ID
    Title               string        `json:"title"`
    PlaybackStatus      PlaybackState `json:"playback_status"`       // "PLAYING" | "PAUSED" | "BUFFERING" | "IDLE"
    BasePositionMs      int64         `json:"base_position_ms"`      // Offset position in milliseconds
    StartedAtServerTime time.Time     `json:"started_at_server_time"`// Anchor time when status became PLAYING
    ControlledBy        uuid.UUID     `json:"controlled_by"`         // User who triggered current state
    Version             uint64        `json:"version"`               // Monotonic version for stale command guard
    UpdatedAt           time.Time     `json:"updated_at"`
}
```

### Authoritative Playback Position Formula

At any instantaneous moment, the canonical playback position is calculated deterministically without requiring high-frequency server ticks:

$$\text{CurrentPositionMs} = \begin{cases} \text{BasePositionMs} & \text{if Status} = \text{PAUSED} \\ \text{BasePositionMs} + (\text{ServerNow} - \text{StartedAtServerTime}) & \text{if Status} = \text{PLAYING} \end{cases}$$

> **Performance Invariant:** The Go backend **never** writes continuous playback progress to PostgreSQL. The state is maintained in RAM and only the initial track selection is persisted to room media history.

---

## 3. Clock Synchronization & Drift Correction

### Clock Offset Calibration (NTP-Style Handshake)
Clients compute server clock offset $O$ using roundtrip ping packets:
1. Client records $t_0$ and sends `connection.ping`.
2. Server responds immediately with `connection.pong` containing `server_time` ($T_s$).
3. Client receives response at local time $t_1$.
4. Calculated offset:
   $$\text{RoundTrip} = t_1 - t_0$$
   $$\text{ClockOffset} = T_s - \left(t_0 + \frac{\text{RoundTrip}}{2}\right)$$
   $$\text{ServerNow} = \text{LocalDate.now()} + \text{ClockOffset}$$

### Three-Tier Drift Correction Engine

On the frontend, every 500ms the client compares its local player position ($P_{local}$) with canonical calculated position ($P_{server}$):

$$\Delta_{\text{drift}} = P_{local} - P_{server}$$

```
                |Δ_drift| < 250ms
       ┌─────────────────────────────────┐
       │     TIER 1: PASSIVE NO-OP       │
       │   - Inaudible / natural drift   │
       │   - Do not touch player         │
       └─────────────────────────────────┘

          250ms <= |Δ_drift| <= 1000ms
       ┌─────────────────────────────────┐
       │     TIER 2: SOFT CORRECTION     │
       │   - Nudge playback rate to      │
       │     0.95x or 1.05x for 2 sec    │
       │   - Prevents abrupt audio pops  │
       └─────────────────────────────────┘

                |Δ_drift| > 1000ms
       ┌─────────────────────────────────┐
       │     TIER 3: HARD SEEK RESYNC    │
       │   - Force seek to P_server      │
       │   - Used on late join/scrub     │
       └─────────────────────────────────┘
```

---

## 4. Provider Capability Matrix

Providers offer radically different browser control APIs. Loft enforces an explicit capability contract:

| Capability | YouTube IFrame | Spotify Web SDK | SoundCloud Widget |
| :--- | :--- | :--- | :--- |
| **CanPlay / CanPause** | Yes | Yes (Premium req.) | Yes |
| **CanSeek** | Yes | Yes | Yes |
| **CanReadPosition** | Yes (`getCurrentTime`) | Yes (State Event) | Yes (`getPosition`) |
| **CanAdjustRate** | Yes (`setPlaybackRate`)| No (1.0x fixed) | No |
| **Requires User Auth** | No (Public URLs) | Yes (OAuth token) | No (Public tracks) |
| **Supports Embed** | Yes (IFrame) | Yes (Web Playback) | Yes (Widget API) |
| **Autoplay Policy** | Requires User Gesture| Requires User Gesture| Requires User Gesture|

> **Rule:** If a provider does not support dynamic playback rate adjustment (e.g., Spotify, SoundCloud), Tier 2 soft correction is skipped and Tier 3 hard seek is triggered when drift exceeds $750\text{ms}$.

---

## 5. Race Condition Resolution & Stale Command Guards

| Race Scenario | Resolution & Server Rule |
| :--- | :--- |
| **Two users press Play/Pause simultaneously** | Only the first command to acquire the `RoomActor` lock succeeds. Second command compares `expected_version` with updated `version` and is rejected with `ERROR_STALE_VERSION`. |
| **User seeks while host switches tracks** | Seek command contains `expected_media_id`. Server detects mismatch (`expected_media_id != current_media_id`) and ignores the seek. |
| **Late joiner connects during playback** | Server dispatches `room.snapshot` containing exact canonical timestamp. Client immediately initializes player at calculated offset. |
| **Host disconnects during media playback** | Playback continues uninterrupted; media authority resides in the `RoomActor`, not in the host's browser. |
