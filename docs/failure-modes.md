# Failure Modes & Resilience Matrix — Loft

## 1. Overview & Resilience Philosophy

Loft is engineered under the assumption that networks drop, nodes crash, and third-party dependencies experience outages.
- **Fail Gracefully:** A failure in an auxiliary component (e.g. YouTube API or Redis) must **not** crash the entire room or prevent users from speaking or chatting.
- **Durable Integrity First:** In any partial failure, the system refuses to report a persistent change as successful unless PostgreSQL has committed it.

---

## 2. Comprehensive Failure Modes Analysis

### 1. Go Process Hard Crash (`SIGKILL` / OOM)
- **Impact:** Active WebSocket connections on that node terminate immediately.
- **Detection:** Upstream reverse proxy (Caddy/Cloudflare) detects TCP drop; health check fails.
- **Expected Behavior:** Clients detect socket closure and transition to `RECONNECTING`.
- **Recovery:** Clients use backoff + jitter to reconnect to another healthy Go instance and request `room.snapshot`.
- **User-Visible Behavior:** Subtle "Reconnecting..." badge appears for 1–2 seconds; audio/video in LiveKit continues uninterrupted.
- **Data Integrity:** Ephemeral presence in Redis expires via 15s TTL; durable data in PostgreSQL is unaffected.

### 2. Redis Unavailable / Crashed
- **Impact:** Multi-instance fan-out disabled; distributed rate limit counters and presence leases unavailable.
- **Detection:** Redis ping health check fails; errors logged by `go-redis`.
- **Expected Behavior:** Go backend falls back to local in-memory presence and in-memory rate limiting.
- **Recovery:** Node attempts reconnection with exponential backoff; when Redis returns, state resynchronizes.
- **User-Visible Behavior:** Users on the same Go node experience normal operation; cross-instance presence updates may be delayed.
- **Data Integrity:** Zero durable loss. Redis contains no durable truth.

### 3. PostgreSQL Temporarily Unavailable
- **Impact:** Cannot create new rooms, sign up new accounts, or archive chat messages.
- **Detection:** `pgxpool.Ping()` fails; SQL queries return connection errors.
- **Expected Behavior:** Active rooms continue in-memory (media sync, voice, video, screen share, ephemeral chat). Database writes fail with `503 SERVICE_UNAVAILABLE`.
- **Recovery:** Chat batcher retains pending messages in bounded memory buffer until connection recovers.
- **User-Visible Behavior:** Banner: "Database connectivity degraded. Message history may not save."
- **Data Integrity:** No partial or corrupt records written.

### 4. Supabase Auth Unavailable
- **Impact:** New users cannot log in; existing users cannot refresh expired JWTs.
- **Detection:** JWKS refresh fails; Supabase Auth HTTP API times out.
- **Expected Behavior:** Guests continue joining via Go's local HMAC guest token generator. Existing validated sessions remain active until their token expiration timestamp.
- **Recovery:** Cached JWKS public keys continue verifying unexpired tokens.
- **User-Visible Behavior:** Error only when attempting fresh account login.

### 5. LiveKit SFU Unavailable
- **Impact:** Voice, video, and screen sharing tracks cannot connect or drop.
- **Detection:** Client LiveKit SDK triggers `Disconnected` event; backend token requests fail.
- **Expected Behavior:** Application room remains online. Text chat, participant list, reactions, and synchronized YouTube playback continue over WebSocket.
- **Recovery:** Client SDK attempts ICE restart and reconnection.
- **User-Visible Behavior:** Call dock displays "Voice server reconnecting..."; shared media stage continues playing.

### 6. Client Reconnect Storm (e.g. Node Deployment)
- **Impact:** Hundreds of clients attempt simultaneous WebSocket handshakes.
- **Detection:** Sharp spike in HTTP `/ws` upgrade rate metric.
- **Expected Behavior:** Jittered client backoff spreads reconnection wave over 5–10 seconds. Ingress rate limiters protect the Go HTTP server from thread starvation.
- **Recovery:** Connections admitted sequentially, authenticated, and served snapshots.

### 7. Slow Consumer / Frozen Client Tab
- **Impact:** One client ceases reading from its TCP socket (e.g. mobile browser backgrounded).
- **Detection:** Client's outbound buffer channel (`sendChan`) saturates at 256 messages.
- **Expected Behavior:** Non-blocking broadcast drops ephemeral reactions. If saturation persists > 5s, server forcibly terminates socket with code `1008`.
- **Recovery:** Client reconnects upon regaining focus and recovers state via `room.snapshot`.
- **User-Visible Behavior:** Backgrounded tab resyncs smoothly upon foregrounding.

### 8. Host Disconnection & Reconnection
- **Impact:** Room temporarily lacks an active host.
- **Detection:** Host WebSocket closes; no sister connection found in presence map.
- **Expected Behavior:** 15-second grace period timer starts. If host reconnects within 15s, grace timer is canceled. If timer expires, deterministic successor is elected (moderator first, then oldest member).
- **Recovery:** Room state version increments; `room.host_transferred` broadcasted.
- **Data Integrity:** Database updated in transaction `UPDATE rooms SET host_id = ...`.

### 9. Concurrent Host Transfer Attempts
- **Impact:** Two moderators try to transfer host or take host status simultaneously.
- **Detection:** Database optimistic lock on `version` or conditional update `WHERE host_id = $old_host`.
- **Expected Behavior:** First transaction succeeds and commits. Second transaction matches 0 rows and returns `409 Conflict`.
- **User-Visible Behavior:** Second user sees error: "Host was already reassigned."

### 10. Stale / Out-of-Order Media Commands
- **Impact:** Network delay causes an old `pause` command to arrive after another user's `play`.
- **Detection:** In-memory `RoomActor` verifies command `expected_version == current_version`.
- **Expected Behavior:** Stale command is rejected with `ERROR_STALE_VERSION` and dropped.
- **Data Integrity:** Playback timeline remains coherent and locked to the latest authoritative state.

### 11. Third-Party Media Provider Failure (e.g. YouTube Video Removed)
- **Impact:** Client embedded iframe fails to load or triggers playback error code 150.
- **Detection:** Client-side player emits `onError` event.
- **Expected Behavior:** Client reports playback error to server; server advances queue to next track.
- **User-Visible Behavior:** Toast: "Video unavailable, skipping to next track."

### 12. Browser Media Permission Denied
- **Impact:** User clicks Mic / Camera / Screen Share, but browser denies permission.
- **Detection:** `navigator.mediaDevices.getUserMedia` promise rejects with `NotAllowedError`.
- **Expected Behavior:** UI resets toggle state immediately, suppresses crashes, and renders an accessible prompt explaining how to re-enable permissions in browser site settings.
