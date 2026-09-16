# Mingly frontend

Next.js 16 frontend for Mingly. Architecture and UI rules are in [`docs/frontend-plan.md`](../docs/frontend-plan.md).

## Local start

```powershell
Copy-Item .env.example .env.local
pnpm install
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
pnpm test:e2e
```

Never place database credentials, Supabase signing secrets, guest signing secrets, service-role keys, or LiveKit API secrets in `frontend/`.
