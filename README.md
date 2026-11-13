# Mingly

Mingly is a shared space to talk, watch, listen, and hang out with your people. It supports small-group guest invite joins, optional Google identity, persistent host-owned rooms, voice/video/screen sharing, presence, durable chat, and synchronized YouTube playback.

## Current features

- Public landing with no login wall
- Google OAuth through Supabase; authenticated room creation
- Room-scoped guest sessions without accounts
- Opaque invite links and guest policy
- Realtime presence/chat over application WebSocket
- Persistent chat with replies, edits, soft deletion, typing indicators, and revision-based update ordering
- Voice, camera, screen share, and participant audio through LiveKit
- Pre-join device selection and preview, microphone level meter, push-to-talk, and screen-share modes
- Fresh-snapshot reconnect with exponential backoff and jitter
- Adaptive streaming, dynacast/simulcast, screen-share quality hints, and connection quality indicators
- Host room lock, participant kick/ban, and optimistic room governance versioning
- Synchronized YouTube playback with drift correction, collaborative picks/queue, autoplay, and majority skip votes
- Shared persistent whiteboard with undo/redo that skips remote changes and PNG export
- Admin room moderation, account suspensions, audit log, and post-call quality feedback
- Redis Pub/Sub fan-out, distributed admission/rate limits, and ephemeral presence leases
- System/light/dark appearance, responsive Stage-first room UI

Rooms also support membership requests/approval, host transfer/failover, social reactions, and durable room appearance. External music OAuth, recording, discovery, and billing remain out of scope.

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
- PostgreSQL owns profiles, rooms, membership/access requests, chat/revisions, whiteboards, YouTube picks/settings, moderation/audit records, and call feedback.
- Go owns authorization, guest credentials, host rules, active room/media state, snapshots, and WebSocket backpressure.
- Redis coordinates ephemeral presence leases, Pub/Sub, distributed limits, and media ownership across nodes.
- LiveKit owns audio, video, screen tracks, recovery, and media transport.
- React/Zustand owns presentation state only. Browser never chooses host status or LiveKit grants.

Application WebSocket never transports media. Each connection has a 64-event outbound queue; a full queue triggers immediate socket termination. Reconnect requests a new authoritative snapshot rather than replaying an unbounded event log.

## Local setup

Requirements: Node 24 (used by CI), pnpm 12.10.1 (pinned in `frontend/package.json`), Go 1.26+ with the Go 1.27.3 toolchain selected by `backend/go.mod`, a Supabase project, and LiveKit Cloud or a compatible self-hosted server.

1. Copy `frontend/.env.example` to `frontend/.env.local` and set public values.
2. Copy `backend/.env.example` to `backend/.env` and set server values. Replace example credentials and signing secrets with your own. `go run ./cmd/server` loads this file when run from `backend`; exported shell variables take precedence.
3. Apply every `backend/migrations/*.up.sql` file in numeric order (currently `000001` through `000020`) through Supabase SQL Editor or your migration runner.
4. For single-node development without Redis, leave `REDIS_URL` empty (the example points to localhost). Otherwise start Redis and set its URL; multiple backend nodes also need distinct `INSTANCE_ID` values.
5. Start backend in one terminal:

   ```powershell
   cd backend
   go run ./cmd/server
   ```

6. Start frontend in a second terminal:

   ```powershell
   cd frontend
   pnpm install --frozen-lockfile
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

Apply all numbered migrations on a fresh database. Existing deployments must apply pending migrations before starting a backend that uses the new schema.

| Migration | Adds |
| --- | --- |
| `000013` | Persistent whiteboards |
| `000014` | Permanent room endings |
| `000015` | Admin room moderation |
| `000016` | Guest YouTube picks and votes |
| `000017` | Chat replies, edits, soft deletion, and revision history |
| `000018` | Account suspensions and append-only admin audit log |
| `000019` | Call feedback |
| `000020` | Monotonic message revisions for rejecting stale updates |

Migration `000003` adds unique six-digit room codes; legacy invite codes remain accepted. Room creation and host membership share one transaction. Chat persistence succeeds before broadcast. Active playback and presence are ephemeral; YouTube picks and autoplay settings are durable.

See [deployment instructions](docs/deployment.md) for the full migration sequence and production configuration.

Tables have RLS enabled and direct access revoked from Supabase `anon`/`authenticated`; browser business mutations go through Go. Backend connection must use a trusted database role that owns/bypasses these policies.

Rollback only on a disposable database, applying matching `.down.sql` files in reverse numeric order. Rollback is destructive.

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

CI runs backend race tests with isolated PostgreSQL/Redis fixtures, vet/build, and frontend lint, type-check, tests, and build. The database and Redis integration tests are opt-in locally (`LOFT_RELEASE_DB_TEST=1`, `LOFT_RELEASE_REDIS_TEST=1`) and require disposable services and the auth fixture in `backend/testdata/release-auth.sql`. Ordinary local test runs skip those checks when the flags are absent.

## Administration

Set `ADMIN_USER_IDS` to comma-separated Supabase user UUIDs and sign in at `/admin`. Admins can end rooms, suspend non-admin accounts temporarily or permanently, lift suspensions, inspect the audit log, and view seven-day call feedback summaries. Admins cannot suspend themselves or other configured admins.

Account suspensions block authenticated REST requests, WebSocket admission, and media-token issuance. Inter-node notifications disconnect active sessions; existing sockets also recheck every 15 seconds if a notification is missed. Guests have no durable account and use room-level moderation.

Room owners can leave alone or end a room for everyone. Ending invalidates the invite and preserves chat/whiteboard history; it is separate from deleting a room.

## Security controls

- Supabase issuer/audience/expiry/signature verification with JWKS cache
- Exact-origin CORS and WebSocket origin allowlist
- Room-scoped short-lived guest JWTs; 32-character minimum signing secret
- Server-owned host role and LiveKit identity (`user:<uuid>` / `guest:<uuid>`)
- 32 KiB standard JSON request limit; whiteboard patches allow 256 KiB; WebSocket client events allow 16 KiB; chat allows 2,000 runes
- Parameterized SQL, bounded DB pool, distributed rate limits for connections, guest/room/chat/reaction/media operations
- Structured logs without access, guest, or LiveKit tokens
- Persistent room passwords are one-way verified before guest credentials are issued; password
  material is never placed in invite URLs, previews, snapshots, logs, or metrics.
- React text rendering only; user chat is never inserted as HTML

## Verification checklist

Use two browser profiles:

- Create a room through Google and copy `/join/<public-room-id>`.
- Join once as host and once as guest; test both open and password-protected admission.
- Verify presence, chat, reactions, voice, camera, screen share, YouTube playback, and queue controls.
- Lock the room: existing guests remain; a new guest is rejected.
- Test kick and temporary ban, then verify re-entry is rejected.
- Edit/delete a message while another client replies; confirm content and quotes converge after reconnect.
- Have two people edit the same whiteboard shape; undo must preserve the other person’s change. Export a PNG.
- Vote to skip, then remove a non-voter; confirm the current majority is applied.
- Verify pre-join device choices, push-to-talk, and both screen-share modes on real devices.
- With an admin account, suspend a participant on a different backend node and verify socket/media removal.
- Change room appearance and confirm reconnect/late join receives the saved setting.
- Refresh one client and confirm snapshot recovery, synchronized playback, and persisted chat history.
- Toggle light/dark and inspect Lobby, Home, Join, Room, dialogs, drawers, hover, focus, and mobile layout.

Cloud credentials, Redis/LiveKit services, and browser device permissions are required for the full matrix.

## Operational limits

- Redis is optional for single-node development. When configured, Pub/Sub, distributed admission, media-owner fencing, and rate limits coordinate multiple Go instances; Redis outage blocks new room joins while existing same-node connections can continue local chat. Shared media mutations stop until the coordinator can confirm ownership.
- A room admits one active connection per verified identity. A same-tab reload replaces the previous socket; a different tab receives `DUPLICATE_SESSION`. Idle application connections expire after roughly 30 seconds without traffic, and room capacity is enforced locally and through Redis leases.
- Public rooms admit authenticated invite holders and, when enabled, guests. Private rooms require ownership or approved membership; signed-in users can request access.
- External music OAuth, recording, discovery, and billing remain out of scope. Realtime host authority and durable room ownership are distinct; transferring host status does not transfer ownership.
- LiveKit and Supabase availability depend on configured external projects.
- Social reactions use ❤️, 😂, 🔥, 👏, and 😭. Wave is room-level and ephemeral; Raise Hand is
  self-controlled and reconnect-aware. Automatic AFK is intentionally not inferred.
- Optional SFX is local presentation only; reactions and chat remain silent. Confirm redistribution
  rights and final mastering for user-provided candidate audio before public release.

The full physical-device and two-node Redis release matrix still requires staging execution before production sign-off.

## Development notes

Use the two-terminal commands above on macOS, Linux, or Windows. To expose the frontend on the LAN, run `pnpm dev --hostname 0.0.0.0` from `frontend/`; configure the API origin and backend origin allowlist for that address. Camera/microphone access requires a [secure browser context](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), so use HTTPS for remote-device testing.

The checked-in Makefile targets Windows PowerShell (`pwsh.exe`, `.exe`/`.cmd` paths). Its `make run` target also expects `concurrently`, which is not in the frontend dependency list; use the direct commands above instead.

Frontend environment variables and browser-test commands are documented in [frontend/README.md](frontend/README.md).
