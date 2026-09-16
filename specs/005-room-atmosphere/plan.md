# Implementation Plan: Room Atmosphere

**Branch**: `005-room-atmosphere` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-room-atmosphere/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

Extend the existing durable room model with one validated appearance value containing atmosphere, accent, adaptive-media preference, and the room's existing optimistic-concurrency version. PostgreSQL remains durable truth; the Go domain/store layer validates and commits host-authorized changes; the existing room event bus distributes one semantic update after commit; room snapshots hydrate late/reconnecting clients; and the existing frontend room store renders a Stage-shell presentation layer independent of personal light/dark/system mode. Adaptive YouTube color is an optional client-only enhancement based on the existing safe thumbnail URL, cached once per video and always replaceable by the configured static accent.

## Technical Context

**Language/Version**: Go 1.26; TypeScript 5; React 19.2; CSS/Tailwind 4

**Primary Dependencies**: chi 5.3, pgx 5.11, go-redis 9.18, Next.js 16.3, Zustand 5, Framer Motion 13, existing Astryx theme packages, existing YouTube IFrame integration

**Storage**: PostgreSQL `rooms` record for durable appearance; Redis existing room-event Pub/Sub for ephemeral cross-instance delivery; no artwork/blob persistence

**Testing**: Go unit/store/realtime tests including race detector; Vitest component/store tests; Playwright desktop/mobile E2E; real-browser two-peer visual and degradation checks

**Target Platform**: Production Linux backend; modern desktop/mobile browsers at 375–1440+ CSS pixels; server-rendered Next.js frontend

**Project Type**: Existing web application with Go modular-monolith API/realtime backend and Next.js frontend

**Performance Goals**: Appearance changes reach connected local participants immediately and cross-instance participants within the existing room-event latency budget; adaptive derivation runs once per video change; transitions sustain interactive controls and do not reduce call/media quality

**Constraints**: No I/O under realtime locks; bounded payload/work; no media through WebSocket/Redis/backend; no LiveKit/YouTube/Stage remount; no arbitrary CSS/URLs; personal theme independence; reduced-motion and contrast safety; decoration degrades first

**Scale/Scope**: Four atmosphere modes, a five-choice initial accent allowlist, one adaptive-media toggle, one room settings surface, existing multi-instance room population and snapshot protocol

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Source of truth — PASS**: PostgreSQL owns durable appearance; Go validates and mutates; Redis relays only committed semantic state; Zustand renders snapshot/event state.
- **Server authority — PASS**: Existing current-host evaluator and version conflict rules gate mutation. Values are closed enums, never client-authored CSS or URLs.
- **Media/control separation — PASS**: Only semantic appearance values cross the application channel. Palette work is client-side from an approved provider thumbnail; LiveKit tracks and YouTube media bytes are untouched.
- **Bounded realtime — PASS**: Reuse bounded outbound queues, non-blocking broadcast, origin-filtered Redis Pub/Sub, and snapshot recovery. Durable I/O completes outside room locks before broadcast/reconciliation.
- **Verification — PASS**: Design includes domain/store/protocol/store/rendering tests, race detector, responsive E2E, and required real-browser checks for screen share, media continuity, contrast, reduced motion, and weak-device fallback.
- **Extend over replace — PASS**: Extend `domain.Room`, existing migrations/store, `snapshotPayload`, event reducer, room store, settings, and Stage shell. Preserve `ThemeProvider`, `loft.theme`, media store, effect pipeline, and permission architecture.

**Post-design re-check**: PASS. Phase 1 contracts retain one durable owner, semantic typed events, version fencing, bounded values, failure isolation, and no new architecture or invariant exception.

## Project Structure

### Documentation (this feature)

```text
specs/005-room-atmosphere/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/           # Phase 1 output ($speckit-plan command)
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)
```text
backend/
├── migrations/                 # sequential room appearance migration
└── internal/
    ├── domain/                 # appearance enum/value validation and authority
    ├── store/                  # versioned durable room update/read
    └── realtime/               # command, snapshot, event, Redis relay

frontend/
├── src/
│   ├── components/providers/  # preserved personal theme ownership
│   ├── components/room/       # settings controls
│   ├── features/room/         # Stage-shell atmosphere and adaptive derivation
│   ├── stores/                # extend existing authoritative room projection
│   └── types/                 # typed room snapshot/events/commands
└── e2e/                       # responsive and room-atmosphere scenarios
```

**Structure Decision**: Extend the existing two-part web application. No new service, theme framework, state store, media processor, or persistence layer is introduced.

## Complexity Tracking

No constitution violations require justification.
