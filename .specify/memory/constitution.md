<!--
Sync Impact Report
- Version change: scaffold → 1.0.0
- Modified principles: none; initial principles established from Loft architecture
- Added sections: System Boundaries and Constraints; Development and Quality Gates
- Removed sections: none
- Follow-up TODOs: RATIFICATION_DATE requires confirmation of the original adoption date
-->

# Mingly Constitution

## Core Principles

### I. Source-of-Truth Ownership
Every state domain MUST have one authoritative owner. Supabase Auth owns identity; PostgreSQL
owns durable rooms, profiles, memberships, messages, permissions, and bans; Go room authority
owns active room state, host authority, media timeline, queue, and connections; Redis owns only
ephemeral coordination; LiveKit owns WebRTC media transport; and Zustand owns presentation state.
The frontend MUST NOT become authoritative for roles, permissions, room governance, or canonical
media state. This prevents split-brain behavior and protects durable data integrity.

### II. Secure Server Authority
All privileged actions MUST be authorized by centralized domain evaluators on the server. Clients
MUST NOT declare identities, roles, capabilities, or permissions. JWTs MUST be validated for issuer,
audience, expiry, signature, and JWKS keys; guest credentials MUST be room-scoped and time-limited;
origins, CORS, payloads, commands, and rates MUST be explicitly constrained. SQL MUST be
parameterized, arbitrary backend URL fetching is forbidden, secrets MUST remain server-side, and
structured errors and logs MUST avoid leaking credentials or internal details.

### III. Media and Control-Plane Separation
The application WebSocket carries typed JSON control events only. Audio, camera, and screen-share
packets MUST use LiveKit exclusively and MUST never pass through Go WebSocket connections. Protocol
messages MUST use typed Go structs and TypeScript discriminated unions with versioned envelopes.
Local camera previews MUST be mirrored, remote camera tracks MUST be unmirrored, and screen sharing
MUST never be mirrored. Video effects MUST run client-side and degrade before they affect camera or
audio quality, preserving the priority Audio stability > Camera stability > Filter quality.

### IV. Race-Free Bounded Realtime
Realtime code MUST use explicit state machines, bounded channels, cancellation, and ownership for
every goroutine. WebSocket outbound buffers MUST hold 64 events; broadcasts MUST enqueue
non-blockingly; and saturated slow consumers MUST be terminated immediately with CloseNow(). No
database, Redis, LiveKit, HTTP, or socket I/O may occur while holding realtime mutexes. Redis
messages MUST identify their originating instance to prevent rebroadcast loops. Reconnection MUST
fetch a fresh authoritative room.snapshot rather than rely on unbounded event replay.

### V. Verification Before Delivery
Changes MUST extend existing behavior before refactoring or replacing it and MUST be justified by
a verified bug, security or correctness issue, lifecycle problem, or architectural limitation.
Backend concurrency changes MUST pass `go test -race ./...`, and release checks MUST include `go vet
./...`, `go build ./...`, frontend tests, lint, TypeScript checking, and production build. Changes
to camera orientation, screen sharing, synchronized playback, device switching, LiveKit quality,
or degradation behavior MUST include real-browser verification where applicable. Complexity MUST be
supported by evidence such as tests, benchmarks, or profiling.

## System Boundaries and Constraints

Loft is a Next.js/React/TypeScript frontend with a Go modular-monolith backend using chi, typed
WebSockets, Supabase PostgreSQL, Redis, and LiveKit. Six-digit public room codes are canonical;
legacy invite links and internal UUID links remain accepted for compatibility and redirect to the
canonical URL. PostgreSQL migrations are sequential and forward-only.

The host owns room governance and playback controls. Locking blocks new guest admission while
existing participants remain connected. Kicks create durable bans and close active WebSockets.
Chat is persisted before broadcast. Media playback is server-authoritative through timestamp
anchors; clients may predict locally, while drift correction uses tolerance, soft rate correction,
and hard seek resynchronization. Optimistic queue and media mutations MUST use version checks.

Redis outages MUST fall back to bounded local behavior without losing PostgreSQL data. LiveKit
failures MUST NOT take down WebSocket chat or room control. PostgreSQL failures MUST reject durable
writes without crashing active in-memory rooms. Shared content MUST dominate the UI; drawers and
overlays are preferred to permanent dashboards, existing Loft design tokens and Royal Blue MUST be
preserved, animations MUST remain subtle, and dangerous actions MUST use confirmation UI.

## Development and Quality Gates

Engineers MUST inspect `AGENTS.md`, relevant `docs/`, existing frontend and backend code, and tests
before changing code. New work MUST preserve typed protocol boundaries, centralized authorization,
snapshot recovery, and no-I/O-under-lock rules. Database migrations MUST be reviewed for forward-only
ordering and transactional integrity. Pull requests MUST state their source-of-truth decisions,
security implications, concurrency behavior, verification performed, and any intentional invariant
exception.

## Governance

This constitution governs design, implementation, review, and release decisions for Loft. If another
document conflicts with it, the conflict MUST be resolved in favor of this constitution or explicitly
recorded as an approved amendment. Amendments require a written rationale, an impact report, updated
tests or review checks where relevant, and maintainer approval before dependent implementation work
is merged. Versioning follows semantic versioning: MAJOR for incompatible governance changes or
principle removal/redefinition, MINOR for new or materially expanded principles or sections, and
PATCH for clarifications and non-semantic corrections.

Every feature plan and code review MUST check applicable principles. Violations are release-blocking
when they affect correctness, security, data integrity, realtime reliability, or race safety.
Exceptions MUST be explicit, time-bounded where possible, justified by evidence, and assigned an
owner for remediation. The constitution MUST be reviewed whenever the architecture, source-of-truth
boundaries, protocol, or release gates materially change.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): confirm original adoption date | **Last Amended**: 2026-09-15
