# Frontend Architecture & Implementation Plan — Loft

## 1. Frontend Principles & Technology Stack

The Loft frontend provides an immersive, calm, stage-first social hangout experience. It prioritizes media presence and collaborative interaction over complex toolbars or enterprise clutter.

- **Framework:** Next.js (React 19 / 18 App Router) with TypeScript (strict mode enabled).
- **Package Manager:** `pnpm` (fast, deterministic, space-efficient hard links).
- **State Management:** Zustand for lightweight, decoupled, predictable client state slices.
- **Styling & CSS:** Tailwind CSS v3 / v4 with Apple-inspired glassmorphism tokens (`#0066CC` primary accent, Obsidian Dark `#131315` & Clean Daylight `#F5F5F7`).
- **Iconography:** Lucide React for consistent, lightweight geometric icons.
- **WebRTC Client:** LiveKit Client SDK (`livekit-client` and `@livekit/components-react`).

---

## 2. Directory Layout

```
frontend/
├── app/                            # Next.js App Router
│   ├── globals.css                 # Apple-grade design tokens, dark/light themes
│   ├── layout.tsx                  # Root layout with Inter font and theme providers
│   ├── page.tsx                    # Main Loft room interface
│   └── r/                          # Dynamic room routes
│       └── [slug]/
│           └── page.tsx            # Room view by slug
├── components/
│   ├── stage/                      # Stage-first center views (80%+ viewport)
│   │   ├── StageContainer.tsx      # Dynamic stage view switcher
│   │   ├── MusicLounge.tsx         # Vinyl record sleeve, spectrum equalizer, scrubber
│   │   ├── ScreenShareView.tsx     # High-framerate stream viewport, Fit/100% Zoom HUD
│   │   ├── VideoGrid.tsx           # Adaptive video grid with active speaker glow
│   │   └── PreflightModal.tsx      # Guest mic/cam test & onboarding dialog
│   ├── dock/                       # Bottom floating frosted-glass Call Dock
│   │   ├── CallDock.tsx            # Mic, Camera, Screen share, Mode switch, Reactions
│   │   ├── DevicePicker.tsx        # Audio/Video selector popover
│   │   └── ReactionBar.tsx         # Floating reaction burst engine
│   ├── drawers/                    # Non-intrusive flyout side panels
│   │   ├── ChatDrawer.tsx          # Realtime messages with markdown and emoji
│   │   ├── PeopleDrawer.tsx        # Participant list, roles, moderation menu
│   │   └── QueueDrawer.tsx         # Shared media queue with drag-and-drop
│   ├── topbar/                     # Ambient status header
│   │   └── TopBar.tsx              # Loft mark, room link copy, theme toggle
│   └── common/                     # Primitives: Button, Modal, Tooltip, Avatar, Slider
├── stores/                         # Zustand state slices
│   ├── useRoomStore.ts             # Authoritative room state snapshot & version
│   ├── useMediaStore.ts            # Canonical playback state, queue, local drift offset
│   ├── useChatStore.ts             # Chat messages, unread counters, draft text
│   ├── useLiveKitStore.ts          # Tracks, speaking state, device selection
│   └── useUIStore.ts               # Drawer visibility, stage mode, layout preferences
├── services/
│   ├── websocket.ts                # Typed WebSocket client with reconnect state machine
│   ├── livekit.ts                  # LiveKit connection coordinator
│   └── timeSync.ts                 # NTP-like client/server clock offset calculator
├── types/
│   ├── protocol.ts                 # Server and client WebSocket event discriminated unions
│   ├── room.ts                     # Domain models (Room, Member, Role, Permission)
│   └── media.ts                    # Playback status, queue item, provider types
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
└── tsconfig.json
```

---

## 3. Zustand State Separation

To prevent accidental rerender cascades and preserve the single-source-of-truth rule, frontend state is strictly compartmentalized:

```
+-------------------------------------------------------------------------------+
|                               ZUSTAND SLICES                                  |
+-----------------------+-----------------------+-------------------------------+
| Server/Authoritative  | WebRTC Media State    | Local UI State (Client-Only)  |
+-----------------------+-----------------------+-------------------------------+
| - Room details        | - Audio/Video tracks  | - Active drawer (Chat/People) |
| - Members & Roles     | - Speaking detection  | - Local volume slider         |
| - Current Media & Q   | - Screen share tracks | - Device picker popover open  |
| - Room Version        | - Connection quality  | - Theme / layout mode toggle  |
+-----------------------+-----------------------+-------------------------------+
```

---

## 4. Connection State Machine

The client socket connection is modeled as an explicit state machine, eliminating invalid boolean states:

```
[DISCONNECTED]
      │
      ▼ (connect())
[CONNECTING]
      │
      ▼ (socket open)
[AUTHENTICATING]
      │
      ├── (auth success) ──► [CONNECTED]
      │                           │
      │ (auth fail)               ▼ (network loss)
      ▼                      [RECONNECTING]
   [FAILED]                       │
                                  ▼ (socket re-opened)
                             [RESYNCING] ──(snapshot received)──► [CONNECTED]
                                  │
                                  ▼ (retry exhausted)
                               [FAILED]
```

---

## 5. Drift Correction & Media Player Adapters

The media player controller subscribes to `useMediaStore` and maintains sync with the Go server:

1. **Clock Offset Calculation:** On connection and periodically, the client pings the server with `t0`, server replies with `server_time`, client calculates `offset = server_time - (t0 + t1)/2`.
2. **Current Virtual Time:** `server_now = Date.now() + offset`.
3. **Target Playback Position:**
   - If `status == "PAUSED"`: `target_pos = base_position_ms`.
   - If `status == "PLAYING"`: `target_pos = base_position_ms + (server_now - started_at_server_time)`.
4. **Drift Application:**
   - `|current_pos - target_pos| < 250ms`: No action (imperceptible drift).
   - `250ms <= |drift| <= 1000ms`: Soft adjustment (nudge playback rate to `0.95x` or `1.05x` for 2 seconds).
   - `|drift| > 1000ms`: Hard seek to `target_pos`.

---

## 6. Visual Design System & Aesthetics

- **Theme:** Obsidian dark mode by default (`#0B0E14` background, `#141822` surface, `#1E2538` borders).
- **Accent:** Royal Blue (`#0066CC` default; accessible on dark contrast).
- **Stage Center:** Maximizes shared content; video tiles or media player occupy 80%+ of viewport real estate.
- **Drawers:** Fly over or gently compress the stage without destroying layout proportions.
- **Micro-Interactions:** Subtle glowing borders for active speakers (`box-shadow: 0 0 12px rgba(0, 102, 204, 0.6)`), animated reaction bubbles floating upwards using Framer Motion.
