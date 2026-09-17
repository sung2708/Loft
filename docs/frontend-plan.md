# Mingly frontend architecture

This document describes the frontend that exists in `frontend/src`. It is an implementation reference, not a speculative roadmap.

## Runtime stack

| Concern | Current implementation |
| --- | --- |
| Framework | Next.js 16.3 App Router, React 19, strict TypeScript |
| State | Zustand stores in `src/stores` |
| Styling | Tailwind CSS 4 plus semantic variables in `src/app/globals.css` |
| Auth | Supabase Auth through `src/lib/auth/useAuth.ts` |
| HTTP | Typed client in `src/lib/api.ts` |
| Realtime control | WebSocket client in `src/lib/realtime.ts` |
| Media | LiveKit voice, camera, and screen transport |
| Tests | Vitest and Playwright |

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Lobby: resolve an invite, join, sign in, show recent rooms |
| `/home` | Authenticated room management |
| `/join/[roomId]` | Public room preview and admission |
| `/room/[roomId]` | Active room session |
| `/auth/callback` | Supabase OAuth callback |

Only public room identifiers belong in URLs and metadata. Internal UUIDs, guest secrets, passwords, and auth tokens must never appear in shareable metadata.

## Source-of-truth boundaries

- PostgreSQL owns durable rooms, memberships, bans, messages, and room appearance.
- The Go room authority owns active permissions, media queue state, snapshots, and version fences.
- Redis is optional ephemeral coordination for multi-instance operation.
- LiveKit owns voice, video, and screen transport.
- Zustand owns client presentation state and mirrors server snapshots; it never grants permissions.

`RoomSession` keeps WebSocket and LiveKit lifecycles separate. Reconnect replaces client state with a fresh snapshot. UI toggles must not remount the LiveKit tree.

## Current component map

```text
src/app/
  page.tsx                    Lobby
  home/page.tsx               Room dashboard
  join/[roomId]/page.tsx      Join flow
  room/[roomId]/page.tsx      Active-room entry
src/components/
  lobby/LobbyHeader.tsx
  room/*                      Dialogs, settings, and moderation
src/features/room/
  RoomSession.tsx             Realtime and LiveKit orchestration
  RoomView.tsx                Stage, dock, drawers, chat and people
  MusicDrawer.tsx             YouTube player and queue
  SettingsDrawer.tsx          In-room settings
src/stores/*                  Room, chat, music, reaction, SFX and UI state
src/lib/api.ts                HTTP API
src/lib/realtime.ts           WebSocket protocol client
```

## Design tokens

`src/app/globals.css` is canonical.

| Token | Value |
| --- | --- |
| Primary / border | `#101113` |
| On-primary | `#ffffff` |
| Background | `#f4f5f7` |
| Accent surface | `#26282c` |
| Radius | `6px`; circles only for avatars, indicators, switches |
| Motion | `200ms`, `500ms`, or `1150ms`; `cubic-bezier(0.4, 0, 0.2, 1)` |
| Body | `fiveYears`, then Syne/system fallback; 11px/500/1.5 |

Controls using `hover-invert` receive a quiet semantic tint and preserve readable nested labels and icons. Test light and dark themes whenever adding a hover surface.

Room appearance is previewed only in local UI state while the host edits it. `SettingsDrawer` clears the draft on close/Escape; only its explicit save sends `room.appearance.update` and updates the shared authoritative room state.

## UX rules

- Lobby hierarchy: join first, create second, account state third.
- Active rooms remain Stage-first. Desktop drawers take a layout column so the Stage resizes; mobile drawers overlay rather than forcing an unusably narrow Stage.
- User-facing copy is functional and concise. Do not expose LiveKit, WebSocket, Redis, API, or database terms.
- Action labels use one clear verb where possible.
- Errors state what happened and the next useful action; raw server codes stay internal.
- The product slogan is reserved for the brand lockup and metadata.

## Verification

```powershell
cd frontend
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm test:e2e
```

Manual checks:

- Test `/`, `/home`, `/join/<public-id>`, and `/room/<public-id>` at 390px, 1280px, and 1920px.
- Toggle light/dark, then open every modal and drawer.
- Hover and keyboard-focus every action; nested text and icons must retain contrast.
- Verify guest join, authenticated join, room creation, password admission, chat, media controls, reconnect, and room settings.
- Confirm no horizontal overflow and no internal technology name in user-facing copy.
