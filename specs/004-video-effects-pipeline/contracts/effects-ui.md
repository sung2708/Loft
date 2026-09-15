# Contract: Video Effects UI

## Entry and presentation

- Existing camera button remains the primary on/off action; a separate adjacent disclosure is labelled **Video effects**.
- Desktop uses a compact anchored popover; narrow/mobile uses a bottom sheet. Neither becomes a permanent Stage sidebar.
- The surface may explain unavailable media while preventing false activation.

## Single-selection groups

1. **Background**: None, Blur, Custom
2. **Looks**: Natural, Warm, Black & White
3. **Fun**: None, Glasses, Cat ears, Mask, Face paint, Animated Fun

Options expose selected, loading, active, disabled, and unavailable semantics. Thumbnails are static and never own a camera or detector.

## Truthful status

| State | UI obligation |
|---|---|
| Selected + loading | Show selected/loading, not active |
| Active | Show selected/active |
| Partial fallback | Identify failed portion and actual healthy subset |
| Failed/unavailable | Calm inline feedback; camera remains visible |
| Camera off | Preserve desired selection, state camera is off, run nothing |
| Unsupported | Disable affected option with accessible explanation |

Use calm copy such as “This effect isn't available on this device.” and “Camera effects were reduced to keep your call smooth.” Never expose raw browser/model errors.

## Custom background

`Custom → choose JPEG/PNG/WebP → validate/decode locally → preview → Apply`.

Apply requires successful validation. Reject SVG, animated/corrupt files, >8 MiB, and >4096×4096. Replacement disposes prior pending/ready resources. Never display a filesystem path or imply upload/sync/persistence.

## Accessibility and sound

- Use radio-group-equivalent semantics, accessible names/states, visible focus, and non-color status cues.
- Tab reaches controls; arrows may move within groups; Enter/Space selects; Escape closes and returns focus to trigger.
- Closing does not disable the active effect.
- Touch targets follow existing controls; reduced motion removes decorative and animated-effect movement.
- All effect interactions are silent and never alter audio.
