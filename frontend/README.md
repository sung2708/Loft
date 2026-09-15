# Mingly frontend

Next.js 16 App Router client for Loft MVP 1. See the repository [README](../README.md) for architecture, environment setup, migrations, external Supabase/Google/LiveKit configuration, and verification commands.

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm dev
```

Public browser variables only belong in `.env.local`. Never place PostgreSQL credentials, Supabase signing secrets, guest signing secrets, or LiveKit API secrets in this directory.
