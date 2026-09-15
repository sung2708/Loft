# Loft MVP 2

Loft is a realtime social room for small groups (2–12 people): guest invite joins, optional Google identity, persistent host-owned rooms, voice/video/screen sharing, presence, durable chat, and synchronized YouTube playback. Product goal: **we’re here together**.

## MVP 2 scope

- Public landing with no login wall
- Google OAuth through Supabase; authenticated room creation
- Room-scoped guest sessions without accounts
- Opaque invite links and guest policy
- Realtime presence/chat over application WebSocket
- Persistent recent chat in Supabase PostgreSQL
- Voice, camera, screen share, and participant audio through LiveKit
- Fresh-snapshot reconnect with exponential backoff and jitter
- Adaptive streaming, dynacast/simulcast, screen-share quality hints, and connection quality indicators
- Host room lock, participant kick/ban, and optimistic room governance versioning
- Synchronized YouTube playback with drift correction and collaborative queue
- Redis Pub/Sub fan-out, distributed admission/rate limits, and ephemeral presence leases
- System/light/dark appearance, responsive Stage-first room UI

Camera filters and background effects, Spotify/SoundCloud, recording, discovery, billing, and host transfer remain out of scope for MVP 2 and are planned for later milestones.

## Architecture and authority

```text
Google OAuth ---> Supabase Auth
                       |
Browser / Next.js ---- HTTP ----> Go API ----> Supabase PostgreSQL
       |                 ^           |
       +--- WebSocket ---+           +--- scoped token minting
       |
       +--- WebRTC -----------------------> LiveKit SFU
```

- Supabase Auth owns authenticated identity.
- PostgreSQL owns profiles, rooms, authenticated membership, and chat history.
- Go owns authorization, guest credentials, host rules, active application presence, snapshots, and WebSocket backpressure.
- LiveKit owns audio, video, screen tracks, recovery, and media transport.
- React/Zustand owns presentation state only. Browser never chooses host status or LiveKit grants.

Application WebSocket never transports media. Each connection has a 64-event outbound queue; sustained slow consumers are disconnected. Reconnect requests a new authoritative snapshot rather than replaying an unbounded event log.

## Local setup

Requirements: Node 24+, pnpm 11+, Go 1.26+, Supabase project, and LiveKit Cloud project (or compatible self-hosted server).

1. Copy `frontend/.env.example` to `frontend/.env.local` and set public values.
2. Copy `backend/.env.example` to `backend/.env` and set server values. `go run ./cmd/server` loads this file when run from `backend`; exported shell variables take precedence.
3. Apply `backend/migrations/000001_mvp.up.sql`, `backend/migrations/000002_governance.up.sql`, and `backend/migrations/000003_short_room_codes.up.sql` through Supabase SQL Editor or your migration runner.
4. Start backend:

   ```powershell
   cd backend
   go run ./cmd/server
   ```

5. Start frontend:

   ```powershell
   cd frontend
   pnpm install
   pnpm dev
   ```

Open `http://localhost:3000`. Health endpoints: `http://localhost:8080/health` and `/ready`.

## Supabase and Google OAuth

1. Create Supabase project. Copy Project URL and public anon key; never use service-role key in browser.
2. In Google Cloud, create OAuth 2.0 Web Client.
3. Add Supabase provider callback shown by Dashboard under Authentication > Providers > Google. It normally resembles `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Put Google client ID/secret into Supabase Google provider and enable it.
5. Under Supabase Authentication > URL Configuration, set Site URL `http://localhost:3000` and add redirect URL `http://localhost:3000/auth/callback`. Add production callback later.
6. Set `SUPABASE_URL`. New asymmetric projects verify via cached JWKS. Set `SUPABASE_JWT_SECRET` only for a legacy HS256 project.

Go derives user ID from validated JWT claims and upserts only profile display metadata. Request payload user IDs are ignored.

## LiveKit

Create LiveKit project and set public WebSocket URL in frontend. API key and secret belong only in backend environment. Browser requests a short-lived room/identity-scoped grant from Go after successful WebSocket admission. Published sources are limited to microphone, camera, screen share, and screen-share audio.

Guest credentials are HMAC-signed, expire after 12 hours, and include exact room ID. Keep them in `sessionStorage`; they cannot enter another room.

## Database

Migrations create `profiles`, `rooms`, `room_members`, `messages`, and MVP2 governance fields/tables (`rooms.is_locked`, `rooms.version`, `room_bans`). Migration 000003 adds a unique six-digit `rooms.short_code`; the older `invite_code` remains accepted as a legacy alias. Room creation and host membership share one transaction. Chat persistence succeeds before broadcast. Presence and active media state remain ephemeral and never enter PostgreSQL.

Tables have RLS enabled and direct access revoked from Supabase `anon`/`authenticated`; browser business mutations go through Go. Backend connection must use a trusted database role that owns/bypasses these policies.

Rollback for a disposable development database: apply `backend/migrations/000003_short_room_codes.down.sql`, `backend/migrations/000002_governance.down.sql`, and then `backend/migrations/000001_mvp.down.sql` (destructive).

## Commands

```powershell
cd frontend
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build

cd ../backend
go vet ./...
go test ./...
go test -race ./...
go build ./...
```

## Security controls

- Supabase issuer/audience/expiry/signature verification with JWKS cache
- Exact-origin CORS and WebSocket origin allowlist
- Room-scoped short-lived guest JWTs; 32-character minimum signing secret
- Server-owned host role and LiveKit identity (`user:<uuid>` / `guest:<uuid>`)
- 32 KiB HTTP and 16 KiB WebSocket payload limits; 2,000-rune chat limit
- Parameterized SQL, bounded DB pool, distributed rate limits for connections, guest/room/chat/reaction/media operations
- Structured logs without access, guest, or LiveKit tokens
- React text rendering only; user chat is never inserted as HTML

## Manual acceptance

Use two browser profiles. Create a room through Google, copy `/join/<invite-code>`, join as host and guest, verify presence/chat/audio/camera/screen share, lock the room and confirm existing guests stay while a new guest receives `ROOM_LOCKED`, kick the guest, paste a YouTube link, and play it from the host. Refresh one client and confirm snapshot recovery, synchronized playback, and persisted chat history. Cloud credentials, Redis/LiveKit services, and browser device permissions are required for the full matrix.

## Known MVP limits

- Redis is optional for single-node development. When configured, Pub/Sub, distributed admission, media-owner fencing, and rate limits coordinate multiple Go instances; Redis outage falls back to bounded local behavior.
- A room admits one active connection per verified identity. A same-tab reload replaces the previous socket; a different tab receives `DUPLICATE_SESSION`. Idle application connections expire after roughly 30 seconds without traffic, and room capacity is enforced locally and through Redis leases.
- Authenticated invite holders may join; durable non-owner membership is reserved for later product rules.
- Host transfer, advanced moderation, camera filters/background effects, Spotify/SoundCloud, recording, and discovery remain deferred.
- LiveKit and Supabase availability depend on configured external projects.

The full physical-device and two-node Redis release matrix still requires staging execution before production sign-off.
