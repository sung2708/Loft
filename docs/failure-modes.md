# Failure Modes, Resilience & Graceful Degradation — Loft

This document specifies the failure modes, detection mechanics, user impact, and recovery behaviors for Loft.

---

## 1. Resilience Matrix Overview

```
+---------------------+-------------------+---------------------+--------------------+
| FAILING SUBSYSTEM   | DETECTION METHOD  | USER IMPACT         | SYSTEM BEHAVIOR    |
+---------------------+-------------------+---------------------+--------------------+
| PostgreSQL          | Ping / Query Err  | Cannot create rooms | Degrades to read;  |
|                     |                   | or persist chat     | memory state runs  |
+---------------------+-------------------+---------------------+--------------------+
| Redis               | Ping timeout      | Loss of cross-node  | Falls back to local|
|                     |                   | fan-out             | in-memory Hub      |
+---------------------+-------------------+---------------------+--------------------+
| LiveKit SFU         | ICE / Token Err   | Audio/video drops   | WS chat & media    |
|                     |                   |                     | remain 100% active |
+---------------------+-------------------+---------------------+--------------------+
| Supabase Auth       | JWKS fetch / 5xx  | Cannot login        | Guest tokens continue|
|                     |                   |                     | working cleanly    |
+---------------------+-------------------+---------------------+--------------------+
| YouTube Embed       | Iframe onError    | Video fails to load | Advance to next in |
|                     |                   |                     | collaborative queue|
+---------------------+-------------------+---------------------+--------------------+
| Vision Filter Crash | JS Error / Canvas | Video freezes/drops | Disables effects;  |
|                     |                   |                     | raw camera fallback|
+---------------------+-------------------+---------------------+--------------------+
| Client Slow Socket  | Outbound buffer   | Laggy user dropped  | Terminate slow peer|
|                     | full (>64)        |                     | protect fast peers |
+---------------------+-------------------+---------------------+--------------------+
```

---

## 2. Detailed Failure Mode Analysis

### 1. PostgreSQL Unavailable / Database Pool Exhaustion
- **Detection**: `pgxpool.Ping(ctx)` fails; queries return connection refused or context deadline exceeded.
- **User Impact**: Room creation, user profile updates, and chat history queries fail with a friendly toast (*"Database temporarily unavailable"*).
- **System Behavior**: Existing active in-memory rooms continue running in RAM. LiveKit audio/video and YouTube synchronization remain fully operational.
- **Recovery**: Automatic reconnection via `pgxpool` when PostgreSQL comes back online.
- **Data Integrity**: In-flight chat messages that cannot be persisted return `error: MESSAGE_SEND_FAILED` to the sender so the client knows to retry.
- **Observability**: `slog.Error("postgres query failed", "error", err)`; alerts on `database_query_errors_total`.

### 2. Redis Cluster Outage
- **Detection**: Background Redis ping times out ($>500\text{ms}$).
- **User Impact**: In a multi-instance cluster, participants connected to different Go nodes stop receiving each other's messages. Participants on the same node experience zero disruption.
- **System Behavior**: Circuit breaker trips. The Go backend logs an alert and automatically falls back to local in-memory presence and local rate limiting. **The Go process never crashes.**
- **Recovery**: Redis client reconnects with exponential backoff and automatically resubscribes to active room channels.
- **Data Integrity**: Zero permanent data lost (Redis holds only ephemeral state).
- **Observability**: `slog.Error("redis unavailable, falling back to in-memory mode")`.

### 3. LiveKit SFU Unavailable / WebRTC Disconnect
- **Detection**: LiveKit client emits `ConnectionState.Disconnected` or `RoomEvent.Disconnected`.
- **User Impact**: Video tiles display a reconnection spinner; microphone audio cuts out.
- **System Behavior**: **Control Plane Isolation:** The Go WebSocket connection remains healthy. Participants can still chat, send reactions, and co-watch YouTube videos.
- **Recovery**: LiveKit client SDK automatically attempts ICE restarts and WebRTC renegotiation.
- **Data Integrity**: Complete state preserved.
- **Observability**: `slog.Warn("livekit connection lost", "room_id", room.ID)`.

### 4. Supabase Auth / JWKS Unavailable
- **Detection**: Public key verification fails or JWKS HTTP fetch times out.
- **User Impact**: New users cannot log in with email/OAuth.
- **System Behavior**: Cached JWKS keys verify existing JWT sessions. Unauthenticated users can still join rooms as Guests using Go-issued HMAC tokens.
- **Recovery**: Automatic retry when Supabase JWKS endpoint recovers.
- **Observability**: `slog.Error("supabase jwks fetch failed", "error", err)`.

### 5. YouTube Embed Unavailable / Video Blocked
- **Detection**: YouTube IFrame API fires `onError` (code 101/150: playback in embedded players disabled by owner).
- **User Impact**: Player displays video unavailable banner.
- **System Behavior**: The client reports the error to the Go server; the room authority advances to the next track in the collaborative queue (`queue.next`).
- **Observability**: Logged client-side; metrics record `media_playback_failures_total`.

### 6. Go Backend Instance Crash (Node Failure)
- **Detection**: Load balancer health checks (`/healthz`) fail.
- **User Impact**: Connected WebSockets disconnect immediately.
- **System Behavior**: Load balancer shifts traffic to healthy instances.
- **Recovery**: Clients transition to `RECONNECTING` with exponential jitter, reconnect to an alternate Go instance, and fetch authoritative `room.snapshot`.
- **Data Integrity**: Durable messages and room metadata are safe in PostgreSQL. Active media state resumes from last committed anchor.

### 7. Client-Side Video Filter Crash / WebAssembly Exception
- **Detection**: `try ... catch` around `@mediapipe/tasks-vision` frame detection loop.
- **User Impact**: Video effects momentarily stop.
- **System Behavior**: Circuit breaker disables effects (`effectConfig.faceEffect = "none"`, `backgroundEffect = "none"`) and falls back immediately to raw camera stream. The call does not crash.
- **Recovery**: User receives non-intrusive toast (*"Camera effects disabled to keep call smooth"*).

### 8. Camera Permission Revoked Mid-Call
- **Detection**: `navigator.mediaDevices` triggers track `ended` event; LiveKit emits `onMediaDeviceFailure`.
- **User Impact**: Camera tile switches to avatar initials; audio continues streaming.
- **System Behavior**: LiveKit unpublishes camera track; Go UI reflects camera off status.

### 9. CPU Throttling / Device Overheating
- **Detection**: Client render loop averages $>25\text{ms}$ per frame over 3 consecutive seconds.
- **User Impact**: Video filter degrades gracefully (e.g. 30fps → 15fps → blur-only → off).
- **System Behavior**: **Golden Rule Enforced:** Filter quality drops before camera or audio quality degrades.

### 10. Saturated Client Outbound Socket (Slow Consumer)
- **Detection**: WebSocket client `send` channel exceeds capacity (64 items).
- **User Impact**: Saturated client is disconnected.
- **System Behavior**: Server invokes `c.conn.CloseNow()` immediately. Fast clients in the room experience zero latency impact.
- **Recovery**: Client attempts automatic reconnect with cleared buffers.
