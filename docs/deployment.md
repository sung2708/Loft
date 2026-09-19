# Mingly deployment

Production uses a Vercel frontend, a Go service, Supabase PostgreSQL/Auth, optional Redis coordination, and LiveKit media.

## Production origins

| Service | Canonical value |
| --- | --- |
| Frontend | `https://mingly.site` |
| Optional frontend alias | `https://www.mingly.site` |
| Legacy frontend | `loft-amber.vercel.app` redirects through `vercel.json` |

Preview deployments must keep their generated Vercel origin. Do not hard-code `mingly.site` into components.

## Backend environment

| Variable | Required | Default / purpose |
| --- | :---: | --- |
| `DATABASE_URL` | Yes | Trusted PostgreSQL connection |
| `SUPABASE_URL` | Yes | JWT issuer/JWKS project URL |
| `GUEST_TOKEN_SECRET` | Yes | At least 32 characters |
| `HTTP_ADDR` | No | `:8080` |
| `FRONTEND_ORIGINS` | No | `http://localhost:3000`; comma-separated exact CORS/WS origins |
| `SUPABASE_JWT_SECRET` | Legacy only | HS256 projects; asymmetric projects use JWKS |
| `SUPABASE_JWT_AUDIENCE` | No | `authenticated` |
| `REDIS_URL` | Multi-node | Pub/Sub, leases, and distributed rate limits |
| `INSTANCE_ID` | Multi-node | Stable node identifier |
| `LIVEKIT_URL` | For calls | LiveKit WebSocket endpoint |
| `LIVEKIT_API_KEY` | For calls | Server-side key |
| `LIVEKIT_API_SECRET` | For calls | Server-side secret |

Render production CORS:

```text
FRONTEND_ORIGINS=https://mingly.site,https://www.mingly.site
```

Redeploy the backend after changing environment variables.

## Frontend environment

| Variable | Required | Purpose |
| --- | :---: | --- |
| `NEXT_PUBLIC_API_URL` | Production | Public Go API origin |
| `NEXT_PUBLIC_SITE_URL` | Production | Canonical metadata and share origin |
| `NEXT_PUBLIC_SUPABASE_URL` | For sign-in | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For sign-in | Public anon key |
| `NEXT_PUBLIC_LIVEKIT_URL` | For calls | Public LiveKit URL |

Set frontend variables before the Vercel build; `NEXT_PUBLIC_*` values are embedded into the client bundle.

## Database migrations

Apply in order:

1. `000001_mvp.up.sql`
2. `000002_governance.up.sql`
3. `000003_short_room_codes.up.sql`
4. `000004_room_access.up.sql`
5. `000005_temporary_room_bans.up.sql`
6. `000006_room_appearance.up.sql`
7. `000007_room_join_requests.up.sql`
8. `000008_spotify_connections.up.sql` (historical)
9. `000009_spotify_room_picks.up.sql` (historical)
10. `000010_youtube_room_picks.up.sql`
11. `000011_youtube_media_settings.up.sql`
12. `000012_remove_spotify.up.sql`

Do not edit applied migration files. Use a new numbered migration for schema changes.

## Release verification

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

After deployment:

- `GET /health` returns 200.
- `GET /ready` returns 200.
- Frontend API requests use the production backend and pass CORS preflight for GET, POST, PATCH, and DELETE.
- Google callback returns to `https://mingly.site/auth/callback`.
- OAuth callback accepts only configured frontend origins and internal post-login paths; external and protocol-relative destinations fall back to `/`.
- Create, join, password admission, room settings, LiveKit token issuance, WebSocket reconnect, and invite metadata work.
- `/metrics` is reachable only through trusted monitoring infrastructure.

There is currently no committed Dockerfile or Docker Compose stack. Do not advertise a one-command container setup until those artifacts exist.
