# Mingly product UI

Mingly is a shared place for friends to talk, watch, listen, and hang out. Functional screens prioritize the current task; they are not landing pages.

## Primary flows

| Flow | Required decisions | Remove from view |
| --- | --- | --- |
| Lobby | Room/link, Join, Create, account state | Feature cards, technology labels, repeated slogans |
| Join | Room identity, display name, password when required, Join | Protocol status, infrastructure names, duplicate benefits |
| Dashboard | Owned rooms, Create, Settings, Delete | Decorative analytics or promotional copy |
| Active room | Stage, people, media controls, chat/queue drawers | Permanent sidebars, repeated product branding |
| Settings | Name, access/password, lock, appearance, local sound | Duplicate controls and descriptions that do not affect a decision |

## Design tokens

`frontend/src/app/globals.css` is the only source of truth.

### Color

| Role | Value |
| --- | --- |
| Primary, border, light-theme text | `#101113` |
| On-primary | `#ffffff` |
| Page background, dark-theme text | `#f4f5f7` |
| Elevated dark surface / secondary tone | `#26282c` |

Do not add named Tailwind palettes or arbitrary status colors. Communicate status with label, icon, border, and state—not color alone.

### Type

- Functional body and controls: 11px, weight 500, line-height 1.5.
- Functional page titles may use a normal application heading size for legibility.
- Display typography is decorative and must not be applied to room/join/settings titles.
- Brand lockup: readable wordmark plus the slogan once; do not repeat the slogan inside the workflow.

### Shape, spacing, motion

- Radius: 6px. Circles are reserved for avatars, indicators, and switches.
- Spacing values: 4, 8, 12, 16, 20, 24, 28, 32, 40, or 48px.
- Motion: 200ms, 500ms, or 1150ms with `cubic-bezier(0.4, 0, 0.2, 1)`.
- Respect `prefers-reduced-motion`.
- Resolve the stored light/dark/system preference before hydration. A page must never flash one theme and settle into another after an input hover or first interaction.

## Interaction rules

- Every clickable control has visible hover, focus, active, and disabled states.
- Use `hover-invert` only for a quiet semantic tint. It must preserve readable nested text and icons; do not invert an entire card or row.
- On desktop, a room drawer consumes its own layout column so the Stage resizes. On mobile, it may overlay the Stage to preserve usable content width.
- When the remaining Stage is narrow, the call dock keeps mic, camera, screen share, chat, people, and leave visible; queue and reactions are intentionally hidden rather than overflowing the viewport.
- Hover must never be the only way to discover an action.
- Destructive actions require a clear label and confirmation when data loss is irreversible.
- Only the active room host is shown room-management controls (name, access, password, lock, and atmosphere). Other participants can change only their personal device and sound preferences; authorization remains enforced by the server.
- Drawers overlay the Stage. Opening chat, people, queue, or settings must not remount the media session.
- Room atmosphere is shared only after an explicit save. While a host changes an atmosphere, accent composition, or adaptive-media setting, render an immediate local preview on the host's Stage and in the settings drawer; closing or pressing Escape discards that draft.

## Copy rules

- Buttons use one decisive action, usually 1–3 words: Join, Create, Save, Delete, Leave.
- Keep user-defined room and display names verbatim.
- Never expose LiveKit, WebRTC, WebSocket, Redis, Pub/Sub, database, API, or token terminology.
- Empty states say what can be done next.
- Errors state cause and recovery. Example: “Could not connect. Check your connection and try again.”
- Do not show raw exception text, status codes, or generic “unexpected error” when a recovery step is known.

## Responsive verification

Check 390px, 1280px, and 1920px in light and dark themes:

- No horizontal overflow.
- Header brand remains readable; slogan may hide on narrow screens.
- Lobby and Join fit without unnecessary scrolling at common viewport heights.
- Stage remains dominant.
- Drawers and dialogs remain reachable by keyboard.
- Every hover-inverting control retains readable nested text/icons.
