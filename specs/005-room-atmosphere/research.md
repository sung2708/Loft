# Research: Room Atmosphere

## Existing architecture baseline

**Decision**: Extend the existing room record, `domain.Room`, PostgreSQL store, room snapshot, typed realtime reducer, `useRoomStore`, `RoomSettings`, and Stage shell.

**Rationale**: These already own durable room settings, optimistic room versioning, current-host authority, reconnect recovery, Redis cross-instance room events, and presentation. Personal color mode already has separate ownership in `ThemeProvider` and `useUIStore` with the compatibility-sensitive `loft.theme` key.

**Alternatives considered**: A new appearance service, separate Zustand store, Redis-owned appearance, or a second theme provider. All would duplicate authority or create split-brain state.

## Durable model and compatibility

**Decision**: Add non-null room appearance fields with database defaults: `ambient`, standard blue accent, and adaptive media enabled. Read paths also normalize missing/unknown values to the same safe defaults during rolling deployment.

**Rationale**: Existing rooms load deterministically, new rooms require no extra create payload, and appearance survives empty rooms/restarts. A single room `version` fences both access and appearance settings consistently.

**Alternatives considered**: Nullable fields indefinitely, a separate table, or rewriting historical migrations. Nullable values spread fallback logic; a separate one-to-one table adds unnecessary transactional complexity; historical migration edits are unsafe.

## Host mutation and realtime propagation

**Decision**: Add one typed realtime command for current-host appearance mutation. Validate closed enum values, verify current host and expected room version, commit through a host-authorized store operation outside realtime locks, then update the in-memory room projection and publish one semantic event via the existing room bus.

**Rationale**: SPEC 002 makes current host distinct from durable owner. Reusing the room event channel gives local and remote participants identical semantics while PostgreSQL remains truth. Snapshot state resolves missed or reordered events.

**Alternatives considered**: Owner-only HTTP settings, optimistic client-only state, or an appearance-specific Redis lease. These violate current-host product semantics, convergence, or durable ownership.

## App theme composition

**Decision**: Keep `ThemeProvider`, `ThemeMode`, root light/dark classes, SSR bootstrap, and `loft.theme` unchanged. Expose room appearance as scoped semantic data/variables on the room shell only.

**Rationale**: Atmosphere composes with every personal theme without changing preference or creating mode combinations such as `party-dark`.

**Alternatives considered**: Applying atmosphere to the document theme or generating eight combined themes. Both couple unrelated state and risk hydration/persistence regressions.

## Accent catalog

**Decision**: Plan an initial closed catalog of `blue`, `purple`, `green`, `orange`, and `rose`, mapped internally to reviewed light/dark decorative tokens. Product blue and semantic status/focus tokens stay fixed.

**Rationale**: This matches the product brief, gives useful choice, and prevents untrusted values from becoming styles.

**Alternatives considered**: Free-form color picker, arbitrary hex, gradients, or uploaded theme JSON. These expand accessibility and injection risk beyond MVP3.

## Adaptive YouTube background

**Decision**: Derive an optional client-side palette once per current `video_id` from the existing official YouTube thumbnail host, with cancellation, decode/CORS failure handling, bounded sampling, session-memory caching, contrast-safe token mapping, and static-accent fallback.

**Rationale**: Existing UI already loads `https://img.youtube.com/vi/{video_id}/mqdefault.jpg`; no provider video frames or backend proxy are needed. Keeping the result ephemeral avoids turning derived artwork into shared authority.

**Alternatives considered**: Reading IFrame pixels, backend extraction/proxying, per-frame analysis, persisting palettes, or adding a new metadata service. These are blocked by provider/browser policy, violate media boundaries, or add unnecessary cost.

## Rendering and degradation

**Decision**: Render atmosphere behind Stage content through a stable room-shell layer. Use static gradients/surfaces by default, CSS transitions for simple changes, and optional bounded spatial motion only when reduced motion is off. Disable adaptive/blur/motion progressively when unsupported or costly.

**Rationale**: A stable sibling/background avoids remounting Stage, YouTube, or LiveKit tracks. Decoration can fail independently and screen share can explicitly suppress it.

**Alternatives considered**: Wrapping/re-keying Stage per mode, continuous canvas animation, or filtering the Stage subtree. These risk media interruption, GPU cost, and unreadable shared content.

## Event ordering and multi-instance behavior

**Decision**: Carry the resulting full appearance plus authoritative room version in each update. Clients apply only newer room versions; snapshots replace projections. Redis relays the same semantic event with existing origin filtering.

**Rationale**: Full-state events are idempotent, bounded, and robust to loss/reordering. Versioning aligns with existing room access changes.

**Alternatives considered**: Delta events without versions, client timestamps, or event replay. These can diverge and contradict snapshot recovery.
