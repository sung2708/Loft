# Mingly Motion System

Motion communicates state and hierarchy. It must not delay an action, obscure copy, or compete with the active room Stage.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| Fast | `200ms` | Hover, press, icon and control state |
| Base | `500ms` | Drawer, modal and Stage layout transitions |
| Slow | `1150ms` | Low-contrast ambient transitions only |
| Easing | `cubic-bezier(0.4, 0, 0.2, 1)` | All transitions |

These values are defined in `frontend/src/app/globals.css`. Components must consume the CSS variables or use the exact matching Tailwind duration. Do not add one-off timing or easing values.

## Interaction rules

- Hover must preserve readable foreground/background contrast in light and dark themes.
- A control may change background on hover only when its icon and every nested label change to the matching foreground color.
- Press feedback may use a restrained scale change; it must not shift surrounding layout.
- Loading indicators must not block unrelated controls.
- Drawers and modals use the base duration. Ambient media color changes may use the slow duration.
- Realtime updates converge to the latest state; animation queues must never delay authoritative room state.

## Reduced motion

Under `prefers-reduced-motion: reduce`:

- remove translation, scaling, floating reactions and decorative pulses;
- retain immediate state indicators such as mute, connection and speaking status;
- use a fast opacity change only when disappearance would otherwise be confusing.

## Verification

- Test light and dark themes.
- Tab through every interactive control and confirm a visible focus indicator.
- Hover controls with nested icons and labels; no text may disappear.
- Check widths `390`, `768`, `1280` and `1920` pixels.
- Confirm drawers, dialogs and menus remain within the viewport without horizontal scrolling.
