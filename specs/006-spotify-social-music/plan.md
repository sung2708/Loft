# Implementation Plan: Spotify Social Music & Personal Playback

**Branch**: `006-spotify-social-music` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-spotify-social-music/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

Add Spotify as an optional account-level integration while preserving Mingly as room and realtime authority. Use a secure user authorization lifecycle, provider-scoped personal playback, and room-scoped semantic metadata for suggestions and explicitly enabled listening presence. Spotify audio and credentials remain outside Mingly transport and durable room state.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Go backend (repository version), TypeScript/React/Next.js frontend

**Primary Dependencies**: Existing Supabase Auth, PostgreSQL, Redis, typed Go realtime protocol, Zustand, existing profile/settings and room UI; Spotify Web API and optionally Web Playback SDK after policy verification

**Storage**: PostgreSQL for account-level connection metadata and bounded Room Picks; encrypted provider credential lifecycle in the existing secure account boundary; Redis only for ephemeral cross-instance room events

**Testing**: Go unit/integration and race tests; frontend Vitest, Playwright, ESLint, TypeScript; contract tests for privacy and media-boundary invariants

**Target Platform**: Existing web application and supported desktop/mobile browsers; graceful Open-in-Spotify fallback for unsupported playback

**Project Type**: Existing realtime web application with Go modular monolith and Next.js frontend

**Performance Goals**: Debounced search; normal searches return a result or clear provider state within 3 seconds; no polling loop that risks provider quota; room event handling remains bounded and non-blocking

**Constraints**: Account-level OAuth, least privilege, no secrets in client or room channels, private-by-default listening, room isolation, no Spotify audio capture/relay/synchronization, current Spotify Premium/Development Mode/policy limits

**Scale/Scope**: Optional MVP3 experimental integration; tracks-first search, personal playback, Room Picks, lightweight reactions/votes, explicit room/session listening visibility; no playlist editor, ML, or group playback

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Pass. Source of truth is explicit: Spotify owns catalog/account/playback; Go owns room authorization and semantic events; PostgreSQL owns durable account integration and bounded Room Picks; Redis is ephemeral coordination; Zustand is presentation state. No audio crosses WebSocket/LiveKit/Go/Redis/Postgres. Credentials are excluded from room state. All privileged room actions use centralized authorization, and failure isolation preserves core room operation. Research must verify current Spotify policy before implementation.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
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
├── internal/ (existing Go modular-monolith packages)
│   ├── auth/ and account/provider integration
│   ├── rooms/ authority, permissions, and semantic events
│   ├── realtime/ typed WebSocket events
│   └── persistence/ migrations and repositories
└── tests/ (existing backend unit, integration, and race coverage)

frontend/
├── src/
│   ├── app/ profile/settings and OAuth callback surfaces
│   ├── components/room and account UI
│   ├── features/room Spotify search, Room Picks, and personal controls
│   ├── lib/ provider client and typed contracts
│   └── stores/ account/provider and presentation state
└── e2e/ and src/**/*.test.ts(x)
```

**Structure Decision**: Extend the existing backend and frontend modular-monolith directories. Keep account-level Spotify concerns outside room state, expose only typed semantic room events, and reuse existing settings, authorization, realtime, persistence, and test patterns.

## Complexity Tracking

No constitution violations identified; no complexity exception is required.
