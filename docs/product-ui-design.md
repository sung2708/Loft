# Loft — Product UI & Interaction Design System

## 1. Design Vision: A Shared Digital Loft

Traditional video conferencing tools (Zoom, Google Meet, Microsoft Teams) are designed for corporate meetings: rigid video grids, sterile white toolbars, and transactional interfaces that demand constant attention.

**Loft is designed as a shared digital living room (a "Loft").**
- **The Space Recedes, Shared Content Dominates:** Whether listening to lo-fi hip hop, watching a stream, or pair programming, the content occupies 80%+ of the viewport.
- **Calm, High-Aesthetic Presence:** Avatars, speaking waveforms, and reactions feel ambient and organic rather than jarring.
- **Apple-Grade Discipline with Warm Atmosphere:** Crisp typography (Inter + Plus Jakarta Sans), curated slate/obsidian dark surfaces, serene daylight light mode, and a signature Royal Blue accent (`#0066CC`).

---

## 2. Core Information Architecture & Spatial Hierarchy

```
+---------------------------------------------------------------------------------------+
|  HEADER (48px)                                                                        |
|  [Logo + Room Name + Privacy]    [Mode Switcher: Stage | Screen | Music | Video]    [Latency/Peers/Invite/Avatar] |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|                                THE STAGE (Flexible Center)                            |
|                                                                                       |
|   MODE A: Music Lounge          MODE B: Screen Share & Chat   MODE C: 2x2 Video Call  |
|   - Left: Acoustic Feed & LUFS  - Main: Screen Viewport       - 4 Cinematic Portraits |
|   - Center: Vinyl Album & Scrob - Top: 1080p60 / Zoom Scale   - Active Speaker Blue Aura|
|   - Right: Shared Room Queue    - Right: Hangout Chat Drawer  - Ambient Spatial Audio |
|                                                                                       |
+---------------------------------------------------------------------------------------+
|  FLOATING CALL DOCK (Bottom Centered, 56px)                                           |
|  [ Mic Toggle ] [ Camera ] [ Share Screen ] | [ Reactions ] [ Add Media ] | [ Leave ]  |
+---------------------------------------------------------------------------------------+
```

### Spatial Invariants
1. **The Stage Owns the Viewport:** Side panels (Chat, Queue, People) open as non-intrusive drawers or overlay sheets. They never permanently crush or compress the central stage.
2. **Floating Call Dock:** Floats 24px above the bottom viewport edge with a 24px backdrop blur (`rgba(39, 39, 41, 0.8)` in dark mode, `rgba(255, 255, 255, 0.85)` in light mode).
3. **No Three-Column Permanent Clutter:** No permanent Discord-style server sidebars or Slack channel trees.

---

## 3. Design System Tokens & Color Palette

### Dark Mode (Obsidian Loft)
- **Background:** `#131315` (Pure deep slate)
- **Surface Low:** `#1B1B1D` (Card and panel backgrounds)
- **Surface High:** `#2A2A2C` (Input fields, hover states)
- **Surface Highest:** `#353437` (Active toggle pills, elevated tooltips)
- **Border / Outline:** `#2E2E32` (Subtle 1px architectural divider)
- **Primary Accent:** `#0066CC` (Loft signature blue)
- **Secondary Accent:** `#2193FB` / `#A3C9FF` (Glow rings, live pulses)
- **Text On Surface:** `#E4E2E4` (High-contrast crisp white)
- **Text Muted:** `#8B919E` / `#C1C6D5` (Readable metadata)

### Light Mode (Apple Clean Day)
- **Background:** `#F5F5F7` (Signature Apple soft gray)
- **Surface Low:** `#FFFFFF` (Pristine elevated cards)
- **Surface High:** `#EBEBF0` (Subtle control wells)
- **Border / Outline:** `#E5E7EB` (Clean hairlines)
- **Primary Accent:** `#0066CC` (Deep royal blue with 4.5:1 WCAG contrast)
- **Text On Surface:** `#1D1D1F` (Deep obsidian charcoal)
- **Text Muted:** `#6E6E73` (Balanced secondary text)

---

## 4. Typography Hierarchy

| Level | Font Family | Size | Weight | Tracking | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Headline LG** | Plus Jakarta Sans | 32px | 700 / Bold | `-0.02em` | 40px | Track title, stage headers |
| **Headline MD** | Plus Jakarta Sans | 22px | 600 / Semi | `-0.015em` | 28px | Modal titles, room names |
| **Headline SM** | Plus Jakarta Sans | 18px | 600 / Semi | `-0.01em` | 24px | Artist name, section headers |
| **Body LG** | Inter | 16px | 400 / Regular | `-0.008em` | 24px | Primary chat messages |
| **Body MD** | Inter | 14px | 400 / Regular | `-0.005em` | 20px | Standard descriptions, labels |
| **Label LG** | Inter | 14px | 500 / Medium | `-0.006em` | 20px | Button text, tabs |
| **Label MD** | Inter | 12px | 500 / Medium | `+0.002em` | 16px | Badges, track time, tags |
| **Label SM** | Inter | 11px | 600 / Semi | `+0.03em` | 14px | Uppercase metadata, status |

---

## 5. The Four Core Stage Modes

### Mode 1: Music Lounge (Co-Listening Experience)
- **Centerpiece:** High-resolution album art with subtle vinyl hover scale (`scale(1.01)`).
- **Synchronized Scrubber:** Smooth timeline with track duration and hover-scrubber preview.
- **Acoustic Feed (Left Widget):** Displays lossless audio bit-depth, BPM / Key (`92 • F minor`), LUFS dynamic range, and a live 11-bar reactive atmosphere spectrum.
- **Collaborative Queue (Right Widget):** Displays current track with animated equalizer icon, upcoming queue items with contributor attribution (`Added by Linh`), and drag-and-drop reordering handles.
- **Shared Listening Pile:** Overlapping circular avatars showing all active listeners with a pulsing synchronization ring.

### Mode 2: Screen Sharing & Live Workspace
- **Viewport:** 16:9 responsive canvas with zero-latency screen rendering.
- **Scale Controls:** Native `Fit` and `100%` zoom buttons, plus fullscreen stage expansion.
- **Presenter Metadata:** Live resolution badge (`1080p 60fps`), system audio indicator, and active viewer count.
- **Floating Co-Presenter PiP:** Overlapping participant bubbles docked at bottom-right of the screen viewport with real-time mic state and speaking pulses.
- **Hangout Chat Drawer:** Sliding panel with smooth message feeds, reaction chips (`👀 2`, `🔥 1`), system notification pills, and quick emoji selectors.

### Mode 3: Cinematic Video Grid (Social Call)
- **Grid Layout:** 2x2 adaptive responsive layout preserving 16:9 framing.
- **Active Speaker Ring:** Royal Blue `#0066CC` inset border with pulsing soft backlight glow (`box-shadow: 0 0 24px rgba(0, 102, 204, 0.4)`).
- **Audio Waveform Meter:** Animated 4-bar mini equalizer inside participant badge denoting spatial voice transmission.
- **Screen Share Source Picker Popover:** Clean decoupled menu letting users choose between `Entire Screen`, `Window / App`, or `Browser Tab` with audio.

### Mode 4: Frictionless Guest Onboarding & Pre-flight Check
- **Instant Join:** Users enter a display name and jump into the room in $<3$ seconds without mandatory account creation.
- **Pre-Flight AV Check:** Live animated mic sensitivity bar, mute toggle, and camera preview window.
- **Avatar Customization:** Preset geometric avatar selection plus instant photo upload.
- **Durable Identity Path:** Secondary option for persistent Google/Apple OAuth sign-in.

---

## 6. Micro-Interactions & Motion Choreography

- **Reaction Particle Stream:** Clicking floating reaction emojis (`💖`, `🔥`, `👏`, `😂`, `👋`, `🎵`) spawns physics-based bubbles that float upwards 140px–260px with randomized rotational drift and fade out after 1000ms.
- **Call Dock Hover:** Icon buttons scale down gently on tap (`active:scale-[0.96]`) with subtle background shifts.
- **Leave Call Button:** Calm danger color (`#FF453A` dark, `#FF3B30` light) with semi-transparent background to prevent accidental misclicks.
- **Copy Link Feedback:** Button changes state from `Copy` to `Copied!` with checkmark icon for 2000ms before returning to resting state.
