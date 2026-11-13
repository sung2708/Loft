# Mingly deployment

Production uses a Vercel frontend, a Go service, Supabase PostgreSQL/Auth, optional Redis coordination, and LiveKit media.

## Production origins

| Service                 | Canonical value                                         |
| ----------------------- | ------------------------------------------------------- |
| Frontend                | `https://mingly.site`                                   |
| Optional frontend alias | `https://www.mingly.site`                               |
| Admin                   | `https://admin.mingly.site`                             |
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
| `ADMIN_USER_IDS`          |     No      | Comma-separated Supabase user UUIDs allowed to open the read-only admin page; empty disables admin access |
| `METRICS_BEARER_TOKEN`    |     No      | 32+ character secret enabling authenticated `/metrics`; empty disables it |
| `SUPABASE_JWT_SECRET`    | Legacy only | HS256 projects; asymmetric projects use JWKS                           |
| `SUPABASE_JWT_AUDIENCE`  |     No      | `authenticated`                                                        |
| `REDIS_URL`              | Multi-node  | Pub/Sub, leases, and distributed rate limits                           |
| `INSTANCE_ID`            | Multi-node  | Stable node identifier                                                 |
| `LIVEKIT_URL`            |  For calls  | LiveKit WebSocket endpoint                                             |
| `LIVEKIT_API_KEY`        |  For calls  | Server-side key                                                        |
| `LIVEKIT_API_SECRET`     |  For calls  | Server-side secret                                                     |

Render production CORS:

```text
FRONTEND_ORIGINS=https://mingly.site,https://www.mingly.site,https://admin.mingly.site
```

Set a random `METRICS_BEARER_TOKEN` on the backend and the same value as
`MINGLY_METRICS_SCRAPE_TOKEN` on the Prometheus collector. Keep it separate from
the Better Stack remote-write source token.

Redeploy the backend after changing environment variables.

Add `admin.mingly.site` to the frontend project's Vercel **Settings → Domains**.
Use the exact CNAME target Vercel displays in your DNS provider. The host rewrite
in `vercel.json` serves `/admin` at the subdomain root.

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
13. `000013_room_whiteboards.up.sql`
14. `000014_room_endings.up.sql`
15. `000015_room_moderation.up.sql`
16. `000016_guest_room_picks.up.sql`
17. `000017_chat_replies_edits.up.sql`
18. `000018_account_bans.up.sql`
19. `000019_call_feedback.up.sql`
20. `000020_message_revision.up.sql`

Migrations 000017–000020 must be applied **before** rolling out the backend that
uses them: chat history reads the new `messages` columns, the admin user list joins
`account_bans`, and every authenticated request checks suspensions. All three are
additive (new columns/tables only). `admin_audit_log` rejects UPDATE and DELETE via
a trigger. Migration 000020 adds the message revision used to reject stale chat events.

Account suspension notifications use the reserved `room:account-moderation:events`
bus scope. Notifications run on the existing bounded Redis workers, outside the
subscription loop. Every node rechecks PostgreSQL before disconnecting the account and
removing its media participant. Existing sockets also recheck every 15 seconds
so a missed notification does not leave an account connected indefinitely.

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
- Add `https://admin.mingly.site/auth/callback` to Supabase Auth **URL Configuration → Redirect URLs**; keep the canonical Site URL as `https://mingly.site`.
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

Room ending requires migration 000014 before the backend rollout. The new table is additive and does not delete room data. RoomService DeleteRoom closes the SFU session; cached SFU join tokens remain subject to LiveKit token revocation limits. PostgreSQL rejects all new application admissions and token requests after ending.
