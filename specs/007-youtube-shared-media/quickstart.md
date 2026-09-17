# Quickstart Validation: YouTube Experience, Discovery & Shared Queue

## Prerequisites

1. Configure existing Mingly Supabase, PostgreSQL, Redis/LiveKit as needed.
2. Configure a YouTube Data API key only for search validation; do not put it in the browser.
3. Run `make run` and open two browser profiles in the same room.

## Core validation

1. Paste normal and short YouTube URLs; confirm preview, invalid rejection, and existing queue behavior.
2. Search with debounce; verify loading, empty, no-results, quota/error states, and compact metadata.
3. Verify authorized Play Now, unauthorized rejection, Add to Queue, reorder, remove, and duplicate indication.
4. Add and vote Room Picks from two participants; repeat a vote and confirm no double count; promote one pick to queue.
5. Toggle autoplay off/on; end current media with and without queue and confirm one authoritative transition.
6. Open a late joiner and reconnect a client; verify snapshot convergence and no duplicate end transition.
7. Trigger an unavailable/private/non-embeddable item and confirm the queue does not stall.
8. Toggle media adaptation across atmosphere modes and reduced motion; verify no flashing and manual-accent fallback.
9. Start screen share while YouTube plays; verify Stage priority and drawer/player lifecycle remain stable.

## Automated checks

```powershell
Set-Location backend; go test -race ./...; go vet ./...; go build ./...
Set-Location ../frontend; pnpm exec tsc --noEmit; pnpm test -- --run; pnpm run build
```

Run Playwright at 1440, 1280, 1024, 768, 430, and 375 widths for search, queue, picks, reconnect, screen share, and reduced motion. Validate policy items against the links in `research.md` before enabling the experiment.
