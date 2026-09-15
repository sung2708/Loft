# Implementation Plan: Persistent Rooms & Room Access

**Branch**: `001-persistent-rooms-room-access` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-persistent-rooms-room-access/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

Upgrade the existing Loft room system so authenticated owners can reuse durable rooms while guests
retain lightweight account-free joining. Extend the existing PostgreSQL room model, Go domain/store/
HTTP admission path, realtime policy synchronization, Redis-backed failed-password protection, and
Next.js join/Lobby/settings flows. Preserve existing short-code and legacy-link resolution, room lock,
snapshot reconnect, LiveKit admission, presence semantics, and explicit owner deletion.

The design uses PostgreSQL as the durable source of room access policy, Go as the authorization
authority, Redis only for bounded distributed attempt coordination, and typed safe policy updates to
connected clients. Password verification occurs before guest credential issuance; no password material
appears in previews, snapshots, URLs, logs, or metrics.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Go 1.26; TypeScript/React 19; Next.js 16

**Primary Dependencies**: chi/v5, pgxpool, Supabase Auth/JWKS, Redis/go-redis, existing LiveKit token service, Zustand, existing i18n/design tokens

**Storage**: Supabase PostgreSQL for durable room metadata and one-way password verifier; Go memory for active room state; Redis for ephemeral bounded failed-attempt coordination

**Testing**: `go test -race ./...`, `go vet ./...`, `go build ./...`, Go HTTP/domain/store tests, Vitest, ESLint, TypeScript no-emit, Next build, browser and multi-instance acceptance

**Target Platform**: Existing Loft web app on desktop, tablet, and mobile browsers; multiple Go backend instances behind the existing deployment model

**Project Type**: Realtime web application with Go modular-monolith backend and Next.js frontend

**Performance Goals**: Preserve current lightweight join path; representative public-room join under 30 seconds excluding user input/device permissions; no unnecessary polling or room-wide broadcasts; existing 2–12 participant capacity remains

**Constraints**: No plaintext/password verifier leakage; fail closed when durable access policy is uncertain; no I/O under realtime locks; bounded channels/goroutines; snapshot recovery over replay; guests remain account-free; existing MVP2 behavior remains compatible

**Scale/Scope**: One feature across existing `backend/internal/{domain,httpapi,store,realtime,ratelimit}`, sequential migrations, existing frontend Lobby/join/room settings surfaces, and regression coverage; Recent Rooms remains secondary

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: PASS before research.**

- Source of truth is explicit: PostgreSQL owns persistent access policy; Go owns authorization and
  active room state; Redis is ephemeral coordination; client state is non-authoritative.
- Security is centralized: password verification precedes credential issuance; clients cannot set
  roles or policy; URLs/logs/snapshots exclude secret material; access uncertainty fails closed.
- Realtime invariants are preserved: policy persistence and network calls occur outside room locks;
  broadcasts are typed, bounded, and non-blocking; reconnect uses fresh snapshots.
- Compatibility is prioritized: existing room APIs, links, lock/kick, guest join, media admission,
  and deletion are extended rather than replaced.
- Verification gates include race tests, backend/frontend checks, browser accessibility, and
  multi-instance/failure acceptance.

## Project Structure

### Documentation (this feature)

```text
specs/001-persistent-rooms-room-access/
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
├── migrations/                         # sequential room-access schema change
├── internal/domain/                     # room policy entities/evaluators
├── internal/store/                      # transactional room policy persistence
├── internal/httpapi/                    # preview, guest admission, owner settings
├── internal/realtime/                   # active policy synchronization/admission guards
├── internal/ratelimit/                  # bounded failed-password coordination
└── internal/*/*_test.go                 # unit, HTTP, store, and race coverage

frontend/
├── src/app/home/                        # owner room list/create lifecycle
├── src/app/join/[roomId]/               # preview and guest password flow
├── src/app/room/[roomId]/               # room/session policy display
├── src/components/room/                 # settings and delete confirmation
├── src/lib/api.ts                        # typed access contracts
├── src/lib/realtime.ts                   # typed policy events/snapshot behavior
├── src/types/api.ts                      # safe room policy fields
└── src/**/*.{test.ts,test.tsx}           # API, UI, accessibility, reconnect regression

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: Use the existing split web application structure. Backend changes remain in
the current domain/store/http/realtime/ratelimit boundaries, with migrations added sequentially.
Frontend changes extend existing home, join, room, API, type, i18n, and component surfaces. No new
service, framework, or parallel room abstraction is introduced.

## Complexity Tracking

No constitution violations identified. No complexity exception is required.

## Phase 0: Research Summary

See [research.md](./research.md). Research resolved the repository gaps and product choices needed
for design: extend the existing room model, use a server-only one-way password verifier, verify before
guest credential issuance, preserve explicit permanent deletion, keep Recent Rooms secondary, and
fail closed for durable-policy uncertainty.

## Phase 1: Design Artifacts

- [data-model.md](./data-model.md) defines persistent room/access policy, ephemeral sessions, attempt
  budgets, transitions, validation, and invariants.
- [contracts/room-access.md](./contracts/room-access.md) defines safe preview, guest admission,
  owner settings, realtime policy update, and lifecycle semantics.
- [quickstart.md](./quickstart.md) defines backend/frontend baseline checks, core acceptance, failure,
  accessibility, regression, and multi-instance evidence.

## Post-Design Constitution Check

**Status: PASS.** The design keeps PostgreSQL durable truth, centralizes authorization, excludes
secrets from client-visible contracts, preserves guest-first access, uses versioned bounded updates,
keeps I/O outside realtime locks, and does not introduce a parallel room system. Password failures are
rate-limited through Redis/local bounded fallback without making Redis durable or authoritative.
