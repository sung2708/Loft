# Mingly frontend

Next.js 16 frontend for Mingly. Architecture and UI rules are in [`docs/frontend-plan.md`](../docs/frontend-plan.md).

Use Node 24 and pnpm 12.10.1, matching the project package manager and CI. Backend setup and migrations are covered in the [root README](../README.md).

## Local start

Copy `.env.example` to `.env.local` and replace the example values with your project settings. From `frontend/`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. The backend defaults to `http://localhost:8080`.

## Browser environment

| Variable | Required | Purpose |
| --- | :---: | --- |
| `NEXT_PUBLIC_API_URL` | No | Go API origin; defaults to `http://localhost:8080` |
| `NEXT_PUBLIC_SITE_URL` | Production | Canonical metadata/share origin |
| `NEXT_PUBLIC_SUPABASE_URL` | For sign-in | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For sign-in | Public anon key |
| `NEXT_PUBLIC_LIVEKIT_URL` | For calls | Public LiveKit WebSocket URL |

## Verify

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright starts the frontend dev server automatically and uses fake camera/microphone devices. It does not start the Go backend or provision Supabase/LiveKit; configure those for tests that exercise real room flows. Fake-device tests do not replace physical-device call testing.

Never place database credentials, Supabase signing secrets, guest signing secrets, service-role keys, or LiveKit API secrets in `frontend/`.
