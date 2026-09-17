# Documentation and UX audit — 2026-09-16

## Scope

Compared current documentation with the Go routes/configuration, frontend API client, Next.js routes, Zustand/LiveKit implementation, design tokens, and user-facing copy.

## Gap summary

| Priority | Gap | Evidence | Resolution |
| --- | --- | --- | --- |
| High | Frontend plan described nonexistent `/r/[slug]`, component folders, stores, and services | Actual routes are `/`, `/home`, `/join/[roomId]`, `/room/[roomId]`, `/auth/callback` | Replaced `docs/frontend-plan.md` with the current tree and ownership model |
| High | UI documentation and internal UI skill required Royal Blue/Obsidian while code uses Kott monochrome tokens | Canonical variables live in `frontend/src/app/globals.css` | Replaced product UI documentation; internal skill update remains blocked by workspace permissions |
| High | Deployment documentation advertised Dockerfile/Compose artifacts that are not committed | Repository has no Dockerfile or compose file | Replaced with actual Vercel/Go/Supabase/Redis/LiveKit flow and an explicit limitation |
| High | Migration instructions stopped at `000004` | Repository contains `000005` and `000006` | README and deployment now require all migrations in numeric order |
| High | API catalog omitted `PATCH /api/v1/rooms/{id}` and documented an unused invite-expiry error | Route exists in `server.go`; invite expiry route/code does not | API catalog corrected |
| High | Hover surfaces changed background while nested labels/icons retained fixed colors | Repeated across Lobby, Home, drawers, settings, menus | `hover-invert` now applies a quiet semantic tint and preserves nested contrast |
| Medium | Frontend README called the app “Loft MVP 1” and omitted variables/tests | Current app is Mingly with MVP3 features | Replaced with concise setup, environment, and verification tables |
| Medium | Current architecture docs still used the old product name | Product identity is Mingly; lowercase compatibility identifiers remain intentional | Updated current docs from product-name “Loft” to “Mingly” |
| Medium | Error translation still has generic fallbacks such as “An unexpected error occurred” | `frontend/src/lib/i18n/uiText.ts` | Keep only as final fallback; feature paths should supply cause plus recovery |
| Low | Compatibility identifiers use `loft.*`, Go module `loft/backend`, and metric prefixes | Persisted/session/module/telemetry compatibility | Intentionally preserved |

## UX findings

### Main flows

- Lobby has the correct action order: Join, Create, account/recent rooms.
- Join keeps authentication optional for guest-enabled rooms and reveals password only when needed.
- Home exposes room management without adding analytics/dashboard clutter.
- Active room remains Stage-first; desktop drawers take a layout column while mobile drawers overlay the session.
- Settings contain both durable room settings and local presentation settings without changing server authority.

### Copy findings

- Internal technology terms are absent from primary UI labels.
- Action labels are generally concise.
- Device/media errors usually include cause and recovery.
- Generic API fallback text remains necessary for unknown failures, but known server errors should always map through `uiText.ts`.
- The slogan appears in the brand lockup and metadata; it should not be duplicated in functional panels.

## Priority backlog

### High

1. Keep `hover-invert` limited to controls that need a quiet hover tint; never use it to invert a static row or card.
2. Add Playwright coverage that asserts computed foreground/background contrast for Lobby, Home, Join, and Room controls in light and dark themes.
3. Protect `/metrics` with trusted ingress/network policy in production.

### Medium

1. Replace generic error fallbacks in individual flows when a deterministic recovery action exists.
2. Add authenticated E2E fixtures for Home and room settings, including password and appearance updates.
3. Split current-state docs from historical ADR/spec material; ADR decisions and completed specs should retain historical context.

### Low

1. Add a committed deployment artifact only if containerized local development becomes supported.
2. Consider renaming source filenames such as `LoftMark.tsx` only as a separate compatibility-safe cleanup; it is not user-facing.

## Verification checklist

### Documentation

- Every route in `docs/api-conventions.md` exists in `backend/internal/httpapi/server.go`.
- Every documented environment variable exists in an example file and runtime config.
- Migration list matches `backend/migrations`.
- Frontend route/component map matches `frontend/src`.
- Current docs use Mingly; old lowercase compatibility identifiers are explained rather than renamed.

### Product

- Test 390px, 1280px, and 1920px in light and dark themes.
- Open Lobby, Home, Join, Room, create/settings/delete dialogs, and all drawers.
- Hover and keyboard-focus every control; labels/icons remain readable.
- Verify empty, loading, reconnecting, permission-denied, not-found, rate-limited, and dependency-unavailable states.
- Verify guest join, password join, authenticated create, room update, kick/ban, reactions, chat, queue, and reconnect.
- Run frontend lint, typecheck, unit tests, build, and E2E.
- Run backend vet, tests, race detector, and build when backend changes.
