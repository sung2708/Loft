# Implementation Plan: Social Reactions & Presence

**Branch**: `003-social-reactions-presence` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: `/specs/003-social-reactions-presence/spec.md`

## Summary

Extend Mingly's existing typed realtime path. Normalize reactions to five values, add room-level Wave
as a bounded ephemeral fact, and add self-controlled Raise Hand to the existing participant state so
snapshots, reconnect, Redis presence, stale-session protection, kick, and leave share one lifecycle.
Keep LiveKit authoritative for media. Add one frontend SFX policy with bounded playback, separate
local/room preferences, graceful browser-audio failure, and no server sound commands.

## Technical Context

**Language/Version**: Go 1.26; TypeScript 5; React 19.2; Next.js 16.3

**Primary Dependencies**: chi, coder/websocket, pgx, go-redis, x/time/rate; Zustand, LiveKit, Framer Motion, Astryx

**Storage**: Existing Go room state and Redis ephemeral coordination; browser localStorage for SFX
preferences; PostgreSQL unchanged

**Testing**: Go test/race/vet/build; Vitest, TypeScript, ESLint, Next build; real-browser
desktop/mobile, reduced-motion, multi-tab, two-instance Redis, and LiveKit checks

**Target Platform**: Modern desktop/mobile browsers and Linux Go service; widths 1440–375

**Project Type**: Existing Next.js frontend plus Go modular-monolith backend

**Performance Goals**: Prompt feedback; at most 6 visible reaction groups; a 100-attempt/10-second
burst remains responsive; no call degradation

**Constraints**: Envelope v1; outbound capacity 64; non-blocking fanout; no I/O under realtime locks;
no durable social writes; snapshots restore current hands but do not replay ephemeral history

**Scale/Scope**: Existing room limits/topology; one hand state per logical participant; one room
social stream; 15 candidate SFX assets requiring validation

## Constitution Check

*GATE: Passed before research and after design.*

| Gate | Design response | Result |
|---|---|---|
| One source of truth | Go participant owns Raise Hand; LiveKit media; Redis ephemeral; frontend presentation | PASS |
| Secure authority | Actor from admitted socket; fixed enums; self-only hand mutation | PASS |
| Media/control separation | Typed JSON facts only; no media/sound payloads | PASS |
| Bounded realtime | Existing 64-item non-blocking queues; ephemeral facts droppable; stale version fencing; no I/O under lock | PASS |
| Snapshot recovery | Snapshot/presence contains current hand; no reaction/Wave replay | PASS |
| Extend before replace | Existing Hub, RedisBus, participant, reaction store, RoomSession and Stage extended | PASS |
| Verification | Race/build plus browser and multi-instance acceptance required | PASS |
| Durable data | No PostgreSQL migration or social persistence | PASS |

Post-design re-check: all contracts and entities preserve these gates. No exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/003-social-reactions-presence/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/social-realtime.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/internal/
├── domain/domain.go
├── ratelimit/limiter.go
└── realtime/
    ├── hub.go
    ├── distributed_limits.go
    ├── redis.go
    └── redis_admission.go

frontend/
├── public/sfx/
└── src/
    ├── components/room/
    ├── features/room/{RoomSession.tsx,RoomView.tsx}
    ├── lib/{realtime.ts,sfx.ts,i18n/}
    ├── stores/{useRoomStore.ts,useReactionStore.ts,useSfxStore.ts}
    └── types/api.ts
```

**Structure Decision**: Preserve the backend/frontend split and extend existing realtime,
participant, Stage, and store modules. Add only focused SFX/social modules where testability requires
them. Do not add another service, database table, WebSocket client, or participant store.

## Phase 0: Research Outcome

[research.md](research.md) resolves all unknowns: room-level Wave, participant-embedded Raise Hand
with monotonic versioning, existing distributed limiter/fanout reuse, frontend-only bounded SFX, no
automatic AFK, and no durable migration.

## Phase 1: Design Outcome

- [data-model.md](data-model.md): ephemeral signals, participant social state, version/lifecycle and SFX preferences.
- [contracts/social-realtime.md](contracts/social-realtime.md): envelope-v1 commands, facts, snapshots and errors.
- [quickstart.md](quickstart.md): automated and real-environment validation.

## Implementation Sequence

1. Lock tests around existing reaction, reconnect, stale close, and LiveKit authority.
2. Extend participant social state and snapshot/presence reconciliation.
3. Add Wave and normalize reaction enums through existing limiter and ephemeral fanout.
4. Extend Stage/tile and accessible Call Dock controls with reduced-motion behavior.
5. Validate and integrate SFX assets behind one local policy/store.
6. Run race, burst, cleanup, browser, multi-instance, and regression gates.

## Complexity Tracking

No constitution violations.
