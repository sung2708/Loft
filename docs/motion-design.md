# Motion Design System & Choreography — Loft

## 1. Motion Philosophy

Loft represents friends sharing a physical room through a digital portal. Every motion should feel:
- **Alive:** State changes, presence updates, and media synchronization feel organic.
- **Spatial:** Components move within a shared, coherent dimensional coordinate space.
- **Responsive:** Interactions yield immediate, tactile micro-feedback (<160ms).
- **Calm & Premium:** No aggressive bouncing, flashy neon pulses, or gaming-style zoom effects.
- **Realtime:** Animations accommodate high-frequency WebSocket bursts and gracefully converge to the latest authoritative state.

> **Prime Directive:** Motion communicates state changes and spatial relationships. Never add motion solely for decoration. When choosing between visually impressive animation and fast readable interaction, always choose fast readable interaction.

---

## 2. Motion Speed & Timing Hierarchy

| Category | Duration | Typical Use Cases | Easing Curve |
| :--- | :--- | :--- | :--- |
| **Micro Interaction** | `120ms – 160ms` | Button hover/pressed, icon toggles, mute switch, tooltips | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **Fast Component** | `160ms – 220ms` | Emoji popover, dropdowns, reaction picker, message entry | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **Standard UI** | `220ms – 300ms` | Drawer slide-in, queue reorder, participant list expansion | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **Stage / Spatial** | `280ms – 420ms` | Stage mode morphs (Music ↔ Screen ↔ Video), focus expansion | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **Ambient Background** | `800ms – 1800ms` | Album color adaptation, ambient glow drift, day/night shift | `cubic-bezier(0.4, 0, 0.2, 1)` |

---

## 3. Easing System

1. **Entrance Curve:** `cubic-bezier(0.16, 1, 0.3, 1)`
   - Used for all entering UI elements, popovers, stage switches, and modal dialogs.
   - Provides quick deceleration with gentle settling (no elastic overshoot).
2. **Spatial Layout Curve:** `cubic-bezier(0.25, 1, 0.5, 1)`
   - Used for grid rearrangement, queue sorting, and drawer stage compression.
3. **Exit Curve:** `cubic-bezier(0.4, 0, 1, 1)`
   - Accelerated exits ensuring dismissing elements clear the user's view rapidly.
4. **Spring Restraint:**
   - Spring physics, when used with Framer Motion, must use high damping (`damping: 28–32`, `stiffness: 280–320`) and negligible bounce.

---

## 4. The 5 Signature Motions

### 1. Stage Morph
When transitioning between Stage modes (e.g., Music Lounge → Screen Share):
- The stage does **not** hard-cut.
- The outgoing view gently dissolves (`opacity: 1 → 0`, `scale: 1 → 0.98` over 240ms).
- The incoming view emerges (`scale: 0.98 → 1`, `opacity: 0 → 1` over 320ms).
- The spatial envelope feels like the same room transforming its central activity.

### 2. Spatial Drawer
Opening Chat, Queue, or People drawers does **not** simply overlay or abruptly squash content:
- As the drawer enters from the right (`translateX(100%) → 0` over 300ms), the central Stage concurrently resizes its layout container with the exact same timing and easing curve (`cubic-bezier(0.16, 1, 0.3, 1)`).
- Media and shared screen content maintain aspect ratio smoothly without clipping or jarring aspect jumps.

### 3. Ambient Shift
When a new music track begins or stage mode shifts:
- The ambient radial blur glow behind the player slowly transitions its primary chromatic hue over 1200ms–1600ms.
- Transitions remain low-contrast, avoiding bright flashes or aggressive disco-style strobing.

### 4. Presence Bloom
When a participant joins the room or turns on their camera:
- The presence tile smoothly blooms in (`opacity: 0 → 1`, `scale: 0.97 → 1` over 220ms).
- Existing grid tiles glide into their new positions through GPU-accelerated layout interpolation.
- Camera off: The video stream crossfades into the avatar placeholder without destroying or recreating DOM nodes.

### 5. Realtime Pulse
Speaking and connection state changes provide clear, dampened feedback:
- **Speaking Start:** Subtle green active ring appears within 120ms with low-intensity glow.
- **Speaking End:** Decays over 350ms to prevent flickering on short vocal pauses or breaths.
- **Connection Recovery:** Subtle, non-intrusive status pill transitions to "Back online" for 1.5s, then gracefully fades away without blocking the screen.

---

## 5. Component Choreography Specifications

### Call Dock
- **Entrance:** Rises by 10px while fading in (`y: 10 → 0`, `opacity: 0 → 1` over 280ms) upon entering the room, then remains completely static.
- **Button Micro-interactions:**
  - Hover: `scale: 1.03`, background tint transition in 120ms.
  - Active/Pressed: `scale: 0.97` in 100ms.
  - Mic Mute: Immediate tactile color switch (slate/green ↔ coral red) with icon state transition.

### Chat & Reactions
- **New Message:** Glides up by 4px (`y: 4 → 0`, `opacity: 0 → 1` over 160ms).
- **Floating Reactions:** Float upward over 900ms–1100ms with a slight initial scale-up (`0.85 → 1`), subtle horizontal drift (`±12px`), and gentle fade-out (`opacity: 1 → 0` over the last 300ms).

### Accessibility & Reduced Motion
When `prefers-reduced-motion: reduce` is detected:
- Disable large stage morphs, spatial drawer slide translations, and floating particle trajectories.
- Replace with instantaneous or gentle 150ms opacity fades.
- Maintain critical state communication (mute icons, speaking indicators, connection text).
