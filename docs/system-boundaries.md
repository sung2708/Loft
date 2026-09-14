# System Boundaries & Ownership — Loft

## 1. System Boundary Architecture

Clear ownership boundaries prevent state drift, security vulnerabilities, and distributed race conditions. In Loft, every piece of state has exactly **one** primary owner.

```
+---------------------------------------------------------------------------------------+
|                                     REACT CLIENT                                      |
|  - Renders UI & Stage                                                                 |
|  - Manages Local Inputs / Audio Devices                                               |
|  - Calculates Local Clock Skew & Player Drift                                         |
|  - Never authoritatively mutates room permissions or media state                      |
+---------------------------+-------------------------------+---------------------------+
                            |                               |
                   WebSocket|                               |WebRTC (RTP/RTCP)
                   (Control)|                               |
                            v                               v
+---------------------------+-----------+       +-----------+---------------------------+
|               GO MONOLITH             |       |                LIVEKIT SFU            |
|  - Authoritative Room State & Version |       |  - WebRTC Peer Connections            |
|  - Media Sync Engine & Queue Mutator  |       |  - Selective Forwarding of Tracks     |
|  - Centralized RBAC / Permission Core |       |  - Active Speaker Detection           |
|  - LiveKit Token Minting (Scoped)     |       |  - Simulcast & Adaptive Bitrate       |
|  - Slow Consumer & Backpressure Hub   |       |  - Zero business/room state storage   |
+-------------+-------------------------+       +---------------------------------------+
              |                         |
              | SQL (pgxpool)           | RESP (redis-go)
              v                         v
+-------------+-------------------------+       +---------------------------------------+
|             POSTGRESQL                |       |                 REDIS                 |
|  - Durable Users, Profiles, Accounts  |       |  - Ephemeral Presence Leases (TTL 15s)|
|  - Durable Rooms, Memberships, Roles  |       |  - Inter-node Pub/Sub Event Bus       |
|  - Message Archive & Audit Trail      |       |  - Sliding-window Rate Limit Counters |
|  - Host History & Bans                |       |  - Room-node Affinity Registry        |
+---------------------------------------+       +---------------------------------------+
```

---

## 2. Ownership Contract

### A. Supabase / PostgreSQL Boundary
- **What it Owns:**
  - `users`, `profiles`, `auth_identities`.
  - `rooms`, `room_memberships`, `room_roles`, `room_permissions`.
  - `messages` (chat history with timestamp indices).
  - `bans`, `invites`, `audit_logs`.
- **What it NEVER Owns:**
  - Realtime presence heartbeats.
  - Sub-second playback cursor timestamps.
  - Active WebRTC track subscription tables.
- **Access Rule:** The Go backend connects directly to PostgreSQL via connection pool (`pgxpool`). The React frontend **does not** query Supabase DB directly for room operations; mutations flow through Go HTTP/WS APIs to ensure business validation.

### B. Go Backend Boundary
- **What it Owns:**
  - Business authority: Can user X perform action Y in room Z?
  - Room version counter: Increments monotonically with each authoritative state mutation.
  - Canonical media state: `(provider, media_id, status, base_pos_ms, server_timestamp, version)`.
  - Queue management: Enqueue, dequeue, reorder, delete.
  - LiveKit access grants: Generates JWTs signed with `LIVEKIT_API_SECRET` specifying track permissions.
  - WebSocket lifecycle: Backpressure enforcement, slow-client termination, heartbeats.
- **What it NEVER Owns:**
  - Media stream routing or transcoding (delegated to LiveKit).
  - User password hashing or OAuth flows (delegated to Supabase Auth).

### C. Redis Boundary
- **What it Owns:**
  - `presence:room:<room_id>:<user_id>` keys with strict TTL (e.g., 15 seconds).
  - Pub/Sub channel `room:<room_id>` for horizontal multi-instance fan-out.
  - Distributed rate limit counters with sliding window expiry.
- **Failure Invariant:** If Redis crashes or is flushed, the application experiences transient presence drops or temporary rate limit reset, but **zero durable data loss** occurs. Redis is an accelerator and ephemeral coordination bus, never a database.

### D. LiveKit SFU Boundary
- **What it Owns:**
  - Ingestion and forwarding of Opus audio packets, VP8/H.264 video streams, and screen shares.
  - DTLS handshake, ICE candidate exchange, TURN/STUN relays.
  - Simulcast layer switching and client bandwidth adaptation.
- **Communication Invariant:** LiveKit does not speak to PostgreSQL or Redis. LiveKit receives signed JWT tokens from Go via client connection handshakes, and notifies Go of participant disconnects or track states via signed Webhooks.

### E. React Frontend Boundary
- **What it Owns:**
  - React virtual DOM, layout transitions, Stage vs. Drawer modes.
  - Local browser device enumeration (`navigator.mediaDevices.getUserMedia`).
  - Audio output volume sliders, local mute toggles.
  - Synchronizing third-party iframes (YouTube IFrame API, Spotify Web Playback SDK).
- **Security Invariant:** The client cannot declare itself "Host", change permissions, or force playback state without a valid server-accepted WebSocket event.

---

## 3. Cross-System Workflows & Reconciliation

### Workflow 1: User Joins Room
1. **Client -> Go (HTTP/WS):** Submits Supabase JWT or Guest Token.
2. **Go:** Validates JWT against Supabase public keys; checks ban table in Postgres.
3. **Go:** Allocates room actor in-memory (or connects to existing).
4. **Go -> LiveKit:** Generates scoped LiveKit token with specific grants (`canPublish: true, canSubscribe: true`).
5. **Go -> Redis:** Sets presence key `presence:room:<id>:<user>` with 15s TTL.
6. **Go -> Client:** Returns authoritative `room.snapshot` payload + LiveKit JWT token.
7. **Client -> LiveKit:** Connects directly to SFU using token.

### Workflow 2: Synchronized Play/Pause Command
1. **Client -> Go (WS):** Sends `media.play` with client timestamp and target media ID.
2. **Go:** Checks `CanControlMedia(actor, room)`.
3. **Go (In-Memory Mutex):**
   - Validates that current room media ID matches.
   - Calculates `base_position_ms` and assigns `started_at_server_time = now()`.
   - Increments `room.version`.
4. **Go -> Redis (Pub/Sub):** Publishes `media.state` update to room channel.
5. **Go Nodes -> All Room Clients:** Broadcasts typed `media.state` event.
6. **Clients:** Adjust player position and start playback with drift correction applied.
7. **Postgres:** Playback updates are **not** written to Postgres, preventing database write exhaustion.

---

## 4. Failure Isolation & Graceful Degradation

| Failure Scenario | Isolated Impact | Surviving Features |
| :--- | :--- | :--- |
| **LiveKit Unavailable** | Voice, video, and screen sharing fail to connect or disconnect. | Chat, presence, shared media, room settings continue functioning via Go WebSocket. |
| **Redis Unavailable** | Multi-instance fan-out disabled; fallback to local instance presence and in-memory rate limiting. | Core room communication continues on single instances; DB remains sound. |
| **Supabase Auth Outage**| New user logins fail; token refresh fails. | Existing active sessions and guests continue in rooms until token expiry. |
| **YouTube API Error** | Video iframe displays playback error or stall. | Voice, chat, screen share, and queue management remain fully responsive. |
