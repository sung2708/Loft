# Loft MVP 1

Loft is a realtime social room for small groups (2–12 people): guest invite joins, optional Google identity, persistent host-owned rooms, voice/video/screen sharing, presence, and durable chat. Product goal: **we’re here together**.

## MVP scope

- Public landing with no login wall
- Google OAuth through Supabase; authenticated room creation
- Room-scoped guest sessions without accounts
- Opaque invite links and guest policy
- Realtime presence/chat over application WebSocket
- Persistent recent chat in Supabase PostgreSQL
- Voice, camera, screen share, and participant audio through LiveKit
- Fresh-snapshot reconnect with exponential backoff and jitter
- System/light/dark appearance, responsive Stage-first room UI

Spotify, synchronized media, moderation, Redis, multi-node presence, recording, and host transfer remain out of scope.

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
3. Apply `backend/migrations/000001_mvp.up.sql` through Supabase SQL Editor or your migration runner.
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

Create LiveKit project and set public WebSocket URL in frontend. API key and secret belong only in backend environment. Browser requests a one-hour room/identity-scoped grant from Go. Published sources are limited to microphone, camera, screen share, and screen-share audio.

Guest credentials are HMAC-signed, expire after 12 hours, and include exact room ID. Keep them in `sessionStorage`; they cannot enter another room.

## Database

Migration creates `profiles`, `rooms`, `room_members`, and `messages`, plus query indexes and checks. Room creation and host membership share one transaction. Chat persistence succeeds before broadcast. Presence and media tracks never enter PostgreSQL.

Tables have RLS enabled and direct access revoked from Supabase `anon`/`authenticated`; browser business mutations go through Go. Backend connection must use a trusted database role that owns/bypasses these policies.

Rollback for a disposable development database: `backend/migrations/000001_mvp.down.sql` (destructive).

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
- Parameterized SQL, bounded DB pool, rate limits for guest/room/chat operations
- Structured logs without access, guest, or LiveKit tokens
- React text rendering only; user chat is never inserted as HTML

## Manual acceptance

Use two browser profiles. Create a room through Google, copy `/join/<invite-code>`, join twice as guests, verify presence/chat/audio/camera/screen share, refresh one client, and confirm snapshot recovery plus persisted history. Cloud credentials and browser device permissions are required, so this scenario cannot be automated from a credential-free checkout.

## Known MVP limits

- Single Go process; restart clears presence but not rooms/chat.
- A room admits one active connection per verified identity. A duplicate tab waits for the original to leave; it does not start LiveKit or create a second participant. Idle application connections expire after 60 seconds. Room capacity is enforced by the Go Hub.
- Authenticated invite holders may join; durable non-owner membership is reserved for later product rules.
- No host transfer/failover, moderation, Redis fan-out, media queue, or recording.
- LiveKit and Supabase availability depend on configured external projects.

Next candidates: synchronized media queue, YouTube/Spotify/SoundCloud, moderation, host transfer, Redis multi-instance presence, load tests, and richer metrics.
