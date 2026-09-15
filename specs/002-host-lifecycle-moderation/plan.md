# Implementation Plan: Host Lifecycle & Moderation

**Branch**: `002-host-lifecycle-moderation` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-host-lifecycle-moderation/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

Extend the existing Go room authority, typed realtime protocol, reconnect grace handling,
durable governance store, Redis coordination, LiveKit cleanup, and lightweight participant UI.
Keep durable owner state separate from active host state. Add only the smallest state transitions
and invalidation needed for transfer, failover, kick/ban races, and snapshot recovery.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Go (existing backend module), TypeScript/React (existing Next.js frontend)

**Primary Dependencies**: chi, pgx, Redis client, LiveKit server SDK, typed WebSocket protocol, Zustand

**Storage**: PostgreSQL durable room/membership/ban truth; Go room authority for active host/presence; Redis ephemeral coordination; LiveKit media

**Testing**: go test ./..., go test -race ./..., go vet ./..., go build ./..., Vitest, TypeScript, Next production build, browser acceptance

**Target Platform**: Linux Go service plus responsive browser clients on desktop/tablet/mobile

**Project Type**: Realtime web application / modular monolith

**Performance Goals**: bounded control-plane work; no polling or unbounded goroutines; moderation state converges within existing realtime delivery and reconnect bounds

**Constraints**: no I/O under realtime locks; server-authoritative authorization; snapshot recovery; bounded channels; no media over WebSocket; preserve MVP1/MVP2 compatibility

**Scale/Scope**: existing small-group rooms (2–12 participants), multi-instance Go deployment, one lightweight participant moderation surface

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

PASS — extends existing source-of-truth owners; keeps Go authorization authoritative; preserves typed
protocol and snapshot recovery; uses bounded concurrency and no-I/O-under-lock; keeps LiveKit as media
source of truth; requires race tests and compatibility regression coverage.

## Project Structure

### Documentation (this feature)

```text
specs/002-host-lifecycle-moderation/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/           # Phase 1 output ($speckit-plan command)
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
backend/
├── cmd/server/
├── internal/domain/
├── internal/httpapi/
├── internal/realtime/
├── internal/store/
├── internal/ratelimit/
├── internal/livekit/
└── migrations/

frontend/
├── src/
│   ├── features/room/
│   ├── components/room/
│   ├── stores/
│   ├── lib/
│   └── types/
└── src/app/
```

**Structure Decision**: Preserve the existing backend/frontend modular split. Extend room authority,
domain evaluators, HTTP/WebSocket handlers, durable store operations, and existing participant UI;
do not create a second moderation service or dashboard.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
