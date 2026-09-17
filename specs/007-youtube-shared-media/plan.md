# Implementation Plan: YouTube Experience, Discovery & Shared Queue

**Branch**: `007-youtube-shared-media` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

## Summary

Extend the existing canonical Go media authority, queue commands, YouTube IFrame renderer, room snapshots, Redis media ownership, and Room Atmosphere. Add one search-or-paste discovery flow, safe previews, Room Picks, bounded Suggested candidates, and room-authoritative autoplay without a second media source of truth.

## Technical Context

- **Frontend**: Next.js/React/TypeScript; existing `MusicDrawer`, `MusicPlayback`, Zustand music store, `RoomSession`, and `RoomAtmosphere`.
- **Backend**: Go modular monolith; existing `mediaState`, `applyMedia`, typed realtime envelopes, host authorization, and Redis media authority.
- **Storage**: PostgreSQL for durable pick/history data; Go room authority for active media/queue; Redis only coordination/cache.
- **External services**: YouTube IFrame Player API for rendering and YouTube Data API v3 for bounded search/details, subject to quota and policy verification.
- **Testing**: Go unit/race tests, frontend Vitest/TypeScript, and Playwright/browser verification for player, reconnect, screen share, responsive drawer, and reduced motion.
- **Constraints**: No YouTube proxy, download, extraction, audio relay, arbitrary iframe HTML, client-authoritative autoplay, or parallel playback state.

## Constitution Check

- Canonical media remains Go room authority; frontend remains renderer/presentation. **PASS**
- URL/provider IDs, queue, picks, autoplay, and permissions are server-validated. **PASS**
- YouTube remains an official iframe; no WebSocket/LiveKit media payloads. **PASS**
- Bounded events, idempotent end transitions, snapshot recovery, and no I/O under locks are preserved. **PASS**
- Existing tests plus race/browser coverage are release gates. **PASS**

## Phase 0: Research

See [research.md](./research.md) for quota, embed errors, metadata policy, URL parsing, autoplay authority, and palette decisions.

## Phase 1: Design

See [data-model.md](./data-model.md), [contracts/youtube-room-events.md](./contracts/youtube-room-events.md), and [quickstart.md](./quickstart.md). Design extends current media types and commands; it introduces no replacement playback abstraction.

## Implementation Phases

1. Foundation: parser/details contracts, search quota/error boundaries, typed Room Pick/autoplay fields, migration and snapshot compatibility.
2. Discovery: search-or-paste UI, preview cards, bounded caching/debounce, Play Now/Add Queue integration.
3. Social layer: Room Picks, vote deduplication, promotion to queue, duplicate state rendering.
4. Playback authority: autoplay setting, idempotent end events, unavailable-video recovery, reconnect/late-join assertions.
5. Atmosphere: sanitized thumbnail palette, precedence/fallback, smooth transitions, reduced-motion tests.
6. Hardening: race tests, quota/failure tests, responsive browser matrix, policy review, observability and release checklist.

## Risks & Mitigations

- Search quota exhaustion → debounce, bounded results, normalized query cache, clear fallback.
- Embed restrictions → validate early, preserve queue progress, expose Open in YouTube.
- Duplicate end reports → room generation/version idempotency guard.
- Drawer remount disrupting playback → keep `MusicPlayback` mounted independently of drawer tabs.
- Palette performance/privacy → derive from public thumbnail, clamp locally, cache per video, never send CSS.
