# Mingly deployment

Production uses a Vercel frontend, a Go service, Supabase PostgreSQL/Auth, optional Redis coordination, and LiveKit media.

## Production origins

| Service                 | Canonical value                                         |
| ----------------------- | ------------------------------------------------------- |
| Frontend                | `https://mingly.site`                                   |
| Optional frontend alias | `https://www.mingly.site`                               |
| Legacy frontend         | `loft-amber.vercel.app` redirects through `vercel.json` |

Preview deployments must keep their generated Vercel origin. Do not hard-code `mingly.site` into components.

## Backend environment

| Variable                 |  Required   | Default / purpose                                                      |
| ------------------------ | :---------: | ---------------------------------------------------------------------- |
| `DATABASE_URL`           |     Yes     | Trusted PostgreSQL connection                                          |
| `SUPABASE_URL`           |     Yes     | JWT issuer/JWKS project URL                                            |
| `GUEST_TOKEN_SECRET`     |     Yes     | At least 32 characters                                                 |
| `HTTP_ADDR`              |     No      | `:8080`                                                                |
| `FRONTEND_ORIGINS`       |     No      | `http://localhost:3000`; comma-separated exact CORS/WS origins         |
| `FRONTEND_URL`           |     No      | Canonical allowed frontend origin used after OAuth callbacks           |
| `SUPABASE_JWT_SECRET`    | Legacy only | HS256 projects; asymmetric projects use JWKS                           |
| `SUPABASE_JWT_AUDIENCE`  |     No      | `authenticated`                                                        |
| `REDIS_URL`              | Multi-node  | Pub/Sub, leases, and distributed rate limits                           |
| `INSTANCE_ID`            | Multi-node  | Stable node identifier                                                 |
| `LIVEKIT_URL`            |  For calls  | LiveKit WebSocket endpoint                                             |
| `LIVEKIT_API_KEY`        |  For calls  | Server-side key                                                        |
| `LIVEKIT_API_SECRET`     |  For calls  | Server-side secret                                                     |
| `SPOTIFY_ENABLED`        |  Optional   | Set `true` only after Spotify is fully configured                      |
| `SPOTIFY_CLIENT_ID`      |   Spotify   | Spotify application client ID                                          |
| `SPOTIFY_REDIRECT_URI`   |   Spotify   | Exact HTTPS backend callback URL ending in `/api/v1/spotify/callback` |
| `SPOTIFY_CREDENTIAL_KEY` |   Spotify   | Server-only encryption key for stored provider tokens                  |

Render production CORS:

```text
FRONTEND_ORIGINS=https://mingly.site,https://www.mingly.site
FRONTEND_URL=https://mingly.site
```

Redeploy the backend after changing environment variables.

## Frontend environment

| Variable                        |  Required   | Purpose                             |
| ------------------------------- | :---------: | ----------------------------------- |
| `NEXT_PUBLIC_API_URL`           | Production  | Public Go API origin                |
| `NEXT_PUBLIC_SITE_URL`          | Production  | Canonical metadata and share origin |
| `NEXT_PUBLIC_SUPABASE_URL`      | For sign-in | Supabase project URL                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For sign-in | Public anon key                     |
| `NEXT_PUBLIC_LIVEKIT_URL`       |  For calls  | Public LiveKit URL                  |

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

## Spotify OAuth callback

Spotify must redirect directly to the backend, not to the Next.js application.
Register this exact URL in the Spotify developer dashboard and use the same value
for Render's `SPOTIFY_REDIRECT_URI`:

```text
https://<your-render-backend>.onrender.com/api/v1/spotify/callback
```

The backend stores OAuth PKCE state in Redis for ten minutes, consumes it once,
exchanges the authorization code server-side, persists encrypted credentials in
PostgreSQL, and then redirects the browser to `FRONTEND_URL`. Spotify requires
Redis when enabled; a Redis outage fails OAuth safely instead of using memory
state on only one Render instance. Apply migration `000008` before enabling the
integration.

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

## Tag-based production releases

GitHub Actions deploys production only for stable SemVer tags matching `vMAJOR.MINOR.PATCH`,
for example `v1.2.3`. The workflow in `.github/workflows/release.yml` checks out the commit
referenced by the tag, runs all automated backend and frontend quality gates, deploys that exact
commit to Render, waits for Render to report it as live, verifies `/health` and `/ready`, and then
deploys the same commit to Vercel production.

Configure the `production` GitHub Environment with these secrets:

| Name                | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `RENDER_API_KEY`    | Render account API key used to create and inspect deploys |
| `RENDER_SERVICE_ID` | Render backend service ID (for example `srv-...`)         |
| `VERCEL_TOKEN`      | Vercel access token                                       |
| `VERCEL_ORG_ID`     | Vercel team or account ID                                 |
| `VERCEL_PROJECT_ID` | Vercel frontend project ID                                |

Add `BACKEND_URL` as a `production` Environment variable, using the public backend origin without
a trailing path. Store no secret credentials in repository variables.

Disable Render's automatic deploys in the service dashboard. Tag releases explicitly deploy a
specific commit, and leaving branch auto-deploy enabled could replace it with an untagged commit.
Vercel Git auto-deploy should likewise be disabled for production if production must be tag-only;
preview deployments may remain enabled.

Create and push a release tag only from a reviewed commit:

```powershell
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

The workflow can also be rerun manually for an existing stable tag. Database migrations are not
run by GitHub Actions; apply and verify new forward-only migrations before publishing the tag.

There is currently no committed Dockerfile or Docker Compose stack. Do not advertise a one-command container setup until those artifacts exist.
