# Failure Modes, Resilience & Graceful Degradation — Loft

This document specifies the failure modes, detection mechanics, user impact, and recovery behaviors for Loft.

---

## 1. Resilience Matrix Overview

| Failing subsystem | Detection | User impact | Current behavior |
| :--- | :--- | :--- | :--- |
| PostgreSQL | Ping or query error | New joins, room changes, and chat persistence fail | Existing room state remains in Go memory; failed writes return errors |
| Redis | Pub/Sub or command timeout | Cross-node events and admission can fail | Local Hub continues; cross-node delivery resumes on reconnect |
| LiveKit SFU | SDK connection or token error | Voice/video drops | WebSocket chat and queue remain available |
| Supabase Auth | JWT/JWKS verification error | User login or rejoin fails | Valid guest tokens can still join permitted rooms |
| YouTube Embed | IFrame player error | Track cannot play | Client shows an error; host may skip |
| Slow WebSocket client | Outbound buffer fills | Slow peer disconnects | Fast peers continue receiving local broadcasts |

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
- **System Behavior**: The Go backend logs an error and continues local in-memory room delivery and rate limiting. Cross-node delivery cannot continue until Redis recovers; a multi-instance deployment must treat this as degraded.
- **Recovery**: Redis client reconnects with exponential backoff and resumes its bounded wildcard room subscription.
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
- **System Behavior**: The client displays a playback error. The host can skip the track with `queue.next`; automatic skip is not implemented.
- **Observability**: Logged client-side; metrics record `media_playback_failures_total`.

### 6. Go Backend Instance Crash (Node Failure)
- **Detection**: Load balancer health checks (`/healthz`) fail.
- **User Impact**: Connected WebSockets disconnect immediately.
- **System Behavior**: Load balancer shifts traffic to healthy instances.
- **Recovery**: Clients transition to `RECONNECTING` with exponential jitter, reconnect to an alternate Go instance, and fetch authoritative `room.snapshot`.
- **Data Integrity**: Durable messages and room metadata are safe in PostgreSQL. Active media state is Go-owned and ephemeral; a node crash can lose its current queue/timeline unless a distributed room authority has transferred that state.

### 7. Camera Permission Revoked Mid-Call
- **Detection**: `navigator.mediaDevices` triggers track `ended` event; LiveKit emits `onMediaDeviceFailure`.
- **User Impact**: Camera tile switches to avatar initials; audio continues streaming.
- **System Behavior**: LiveKit unpublishes camera track; Go UI reflects camera off status.

### 8. Saturated Client Outbound Socket (Slow Consumer)
- **Detection**: WebSocket client `send` channel exceeds capacity (64 items).
- **User Impact**: Saturated client is disconnected.
- **System Behavior**: Server invokes `c.conn.CloseNow()` immediately. Fast clients in the room experience zero latency impact.
- **Recovery**: Client attempts automatic reconnect with cleared buffers.
