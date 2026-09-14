# Synchronized Media Playback Engine — Loft

This document defines the synchronized YouTube playback engine for Loft, detailing state authority, timestamp prediction, client drift correction, and playback state transitions.

---

## 1. Legal Architecture & Philosophy

Loft provides a shared media social viewing experience with strict copyright and bandwidth safety:
1. **Zero Media Restreaming**: The Go backend and WebSocket layer **never** download, buffer, transcode, cache, or proxy YouTube audio/video frames.
2. **Official Client Embed**: Media delivery is fulfilled directly between the client's browser and YouTube's CDN using the official YouTube IFrame Player API.
3. **State Authority Only**: The Go backend acts solely as an authoritative timeline coordinator, synchronizing playback status (`PLAYING`, `PAUSED`, `IDLE`), anchor positions, and monotonic state versions.

---

## 2. Canonical Media State Model

```go
type MediaState struct {
    Current    *YouTubeTrack `json:"current"`      // Currently active track
    Queue      []YouTubeTrack`json:"queue"`        // Ordered collaborative queue
    Repeat     bool          `json:"repeat"`       // Repeat active track toggle
    Status     string        `json:"status"`       // "IDLE" | "PLAYING" | "PAUSED"
    PositionMs int64         `json:"position_ms"`  // Anchor playback position
    StartedAt  time.Time     `json:"started_at"`   // Server UTC timestamp when status became PLAYING
    Version    uint64        `json:"version"`      // Monotonic sequence number
}

type YouTubeTrack struct {
    ID          string `json:"id"`                 // Unique stable track UUID
    VideoID     string `json:"video_id"`           // 11-character YouTube video ID
    AddedBy     string `json:"added_by"`           // Display name of contributor
    Title       string `json:"title,omitempty"`    // Video title
    Channel     string `json:"channel,omitempty"`  // Channel / author name
    DurationSec int64  `json:"duration_sec"`       // Total video duration in seconds
}
```

---

## 3. Timestamp-Based Prediction (Zero Periodic Ticks)

### The Anti-Pattern
Broadcasting `currentTime` ticks every second or every frame generates severe network overhead, high CPU wakeups, and latency jitter across clients. Loft **strictly forbids** continuous playback broadcast ticks.

### The Authoritative Anchor Formula
The server maintains a static anchor `(position_ms, started_at)`. Any client computes the canonical instantaneous playback position deterministically:

$$\text{PredictedPositionMs} = \begin{cases} 
\text{PositionMs} & \text{if Status} = \text{PAUSED} \text{ or } \text{IDLE} \\ 
\text{PositionMs} + (\text{ClientNow} + \text{ClockOffset} - \text{StartedAt}) \times \text{PlaybackRate} & \text{if Status} = \text{PLAYING} 
\end{cases}$$

Where:
- $\text{ClientNow}$ is the local browser `Date.now()`.
- $\text{ClockOffset}$ is the NTP-calibrated delta computed from `connection.ping` / `connection.pong`.
- $\text{PlaybackRate}$ is standard $1.0$ (or nudged rate during soft drift correction).

---

## 4. Playback State Transitions & Commands

All media mutations are verified by the Go backend before modifying the in-memory room state:

```
                  ┌──────────────┐
                  │     IDLE     │
                  └──────┬───────┘
                         │ queue.add / queue.select
                         ▼
        ┌──────────────────────────────────┐
        │              PAUSED              │◄────────────────┐
        └───────┬──────────────────▲───────┘                 │
                │                  │                         │
     media.play │       media.pause│              media.seek │
                ▼                  │                         │
        ┌──────────────────────────┴───────┐                 │
        │             PLAYING              ├─────────────────┘
        └───────┬──────────────────────────┘
                │
                ▼ (Canonical Duration Timer Expires)
        [ Automatic Queue Advance / Repeat ]
```

### Command Lifecycle

1. **`media.play`**:
   - Authorized: `CanControlMedia(room, actor) == true`.
   - Verification: Current track must be present; `expected_version == state.Version`.
   - Transition: `Status = "PLAYING"`, `StartedAt = time.Now().UTC()`, `Version++`.
   - Action: Server schedules `mediaTimer` to fire at canonical end time (`DurationSec * 1000 - PositionMs`).

2. **`media.pause`**:
   - Authorized: Host only.
   - Transition: `PositionMs += (Now - StartedAt).Milliseconds()`, `Status = "PAUSED"`, `StartedAt = Zero`, `Version++`.
   - Action: Server stops `mediaTimer`.

3. **`media.seek`**:
   - Authorized: Host only.
   - Transition: `PositionMs = command.PositionMs`. If `PLAYING`, reset `StartedAt = Now`. `Version++`.
   - Action: Server reschedules `mediaTimer`.

4. **`media.duration`**:
   - Host player reports video duration extracted from YouTube iframe API.
   - Updates `Current.DurationSec`, enabling the Go server to manage automatic queue advance.

---

## 5. Three-Tier Client Drift Correction

On the frontend (`frontend/src/features/room/MusicDrawer.tsx`), an internal 1-second interval compares the local YouTube player position ($P_{\text{local}}$) against the calculated canonical position ($P_{\text{predicted}}$):

$$\Delta_{\text{drift}} = P_{\text{local}} - P_{\text{predicted}}$$

```
                 |Δ_drift| < 250ms
        ┌───────────────────────────────────┐
        │      TIER 1: PASSIVE NO-OP        │
        │ • Natural imperceptible drift     │
        │ • Zero player adjustments made    │
        └───────────────────────────────────┘

           250ms <= |Δ_drift| <= 1500ms
        ┌───────────────────────────────────┐
        │      TIER 2: SOFT CORRECTION      │
        │ • Nudge player speed to 0.95x/1.05│
        │ • Smooth audio, avoids pop/clicks │
        │ • Reverts to 1.0x when drift <50ms│
        └───────────────────────────────────┘

                 |Δ_drift| > 1500ms
        ┌───────────────────────────────────┐
        │      TIER 3: HARD SEEK RESYNC     │
        │ • Forces player.seekTo()          │
        │ • Triggered on late join/scrub    │
        └───────────────────────────────────┘
```

---

## 6. Late Join & Reconnect Synchronization

When a client joins an active room or reconnects after an interruption:
1. Client receives authoritative `room.snapshot` containing `mediaState`.
2. Client mounts/cues the active `Current.VideoID`.
3. Client computes $P_{\text{predicted}}$ from the snapshot anchor.
4. Client seeks directly to $P_{\text{predicted}}$ (Tier 3 Hard Seek) and initiates playback if `Status == "PLAYING"` and user gesture activation is present.
5. Result: The user is in sync with the room in $<500\text{ms}$ without custom streaming infrastructure.
