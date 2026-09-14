# Skill: UI Design & Stage-First Experience

## Trigger
Use this skill whenever styling, designing, or implementing user interfaces, stage layouts, video grids, call docks, flyout drawers, or micro-animations in Loft.

## Goals
- Enforce the Stage-First visual hierarchy (shared content dominates 80%+ of the viewport).
- Maintain modern, calm, Apple-disciplined aesthetics with minimal clutter.
- Prevent enterprise toolbars, three-column SaaS dashboards, and gamer/cyberpunk tropes.

## Required reading
- [frontend-plan.md](file:///d:/git/Loft/docs/frontend-plan.md)

## Source of truth
- Design tokens and theme variables in `frontend/src/index.css`.

## Invariants
- **STAGE DOMINATES:** The center stage must never be squeezed into a secondary card.
- **DRAWERS FLY OVER:** Chat, People, and Queue open as non-intrusive drawers or overlay sheets; they must never permanently steal horizontal stage real estate.
- Primary accent color is strictly Royal Blue (`#0066CC`).
- Default theme is Obsidian dark mode (`#0B0E14` background, `#141822` surface, `#1E2538` borders).
- Micro-animations must be subtle (<200ms duration, ease-out); no bouncy or disorienting spring animations.

## Anti-Patterns Strictly Prohibited
- ❌ **Discord Clone:** No permanent server list icon rails or fixed three-column sidebars.
- ❌ **Google Meet / Zoom Clone:** No stark corporate white grids with bulky bottom control bands.
- ❌ **Cyberpunk / Neon / Glass Everywhere:** Avoid tacky neon glows, transparent glass blur overload, and sticky-note textures.
- ❌ **Purple SaaS Gradients:** Avoid generic marketing templates with rainbow borders.

## Workflow
1. Identify the active Stage Mode (`Idle`, `Voice`, `Video`, `WatchParty`, `ScreenShare`).
2. Layout the Stage container to occupy maximum available width and height.
3. Place participant avatar badges in the floating `PresenceStrip`.
4. Dock the floating `CallDock` centered at the bottom with subtle backdrop blur.
5. Implement drawers with sliding transitions using Framer Motion (`x: "100%"` to `x: 0`).
6. Apply active speaker glow using subtle box-shadow (`0 0 12px rgba(0, 102, 204, 0.5)`).

## Implementation rules
- **WHAT TO DO:** Use clean typography, generous intentional whitespace, and crisp 1px borders (`#1E2538`).
- **WHAT NOT TO DO:** Never use raw generic hex colors (`#FF0000`, `#00FF00`); use curated CSS variables.
- **WHY:** Inconsistent ad-hoc colors degrade visual quality and destroy brand identity.
- **HOW TO VERIFY IT:** Inspect visual layout across 1280px, 1920px, and mobile responsive viewports.

## Failure cases
- If media fails to load, stage renders a calm, minimalist placeholder with an actionable retry button, rather than a broken player frame.

## Security considerations
- Ensure user-submitted avatars or display names cannot break layout boundaries or inject CSS expressions.

## Testing
- Test responsive breakpoints (mobile drawer switches to bottom sheet).
- Test keyboard accessibility for mute/deafen hotkeys.

## Verification
- Design feels calm, premium, and focused on co-experience.
- Zero horizontal scrollbars or stage clipping.

## Common mistakes
- Forgetting to constrain video stream aspect ratios (16:9), causing participant tiles to distort.

## Completion report
Upon finishing changes, summarize:
1. Components styled and Stage modes supported.
2. Design token adherence verified.
3. Responsive viewport tests checked.
