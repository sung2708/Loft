# Skill: Frontend Next.js, React & Zustand Architecture

## WHEN TO USE THIS SKILL
Use this skill whenever modifying Next.js 16 components, React 19 hooks, Zustand state stores (`useRoomStore`, `useChatStore`, `useMusicStore`, `useReactionStore`, `useUIStore`), LiveKit UI components, or stage layouts in `frontend/`.

## SOURCE OF TRUTH
- **Authoritative Room & Media State**: Mirrored into Zustand stores from Go server's `room.snapshot` and `media.state`.
- **Client-Local UI State**: `useUIStore` (drawer open/closed, theme, local preferences).
- **WebRTC Tracks**: LiveKit SDK hooks (`useTracks`, `useParticipants`).

## ARCHITECTURAL BOUNDARIES
- The frontend is strictly a presentation and execution client. It is **never** authoritative for permissions, roles, or room rules.
- Local UI state is strictly decoupled from server room state.
- **Zero-Remount Invariant**: Toggling video effects, muting microphones, or switching layouts must **never** remount the entire `RoomSession` or participant tile tree.

## REQUIRED WORKFLOW
1. **Granular Store Subscriptions**:
   - Always subscribe to atomic selectors:
     ```typescript
     const isHost = useRoomStore((state) => state.self?.role === "host");
     const currentTrack = useMusicStore((state) => state.media?.current);
     ```
   - Avoid selecting the entire store state object to prevent unnecessary re-renders.
2. **Explicit Connection FSM**:
   - Model connection state explicitly: `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`, `RESYNCING`, `FAILED`.
   - Never rely on boolean soups (`isLoading && !isReady`).
3. **Handle Server Snapshots Atomically**:
   - When `room.snapshot` arrives, call `applySnapshot()` to replace participants, messages, and media state synchronously.
4. **Coordinate LiveKit & WebSocket Separately**:
   - Obtain LiveKit token via REST API only after WebSocket admission succeeds.
   - Maintain media session continuity even if the control plane socket reconnects.

## IMPLEMENTATION RULES
- Strictly typed discriminated unions for all events (`ServerEvent` in `types/api.ts`). Zero `any` usage.
- Separate local self-preview mirroring (`transform: scaleX(-1)`) from published video tracks.
- Always clean up event listeners, timers, and `requestAnimationFrame` loops in `useEffect` cleanup returns.

## FAILURE CASES
- **Connection Interruption**: Transition to `RECONNECTING`, apply exponential backoff with jitter (`reconnectDelay`), show subtle status indicator, and recover via `room.snapshot`.
- **Duplicate Tab**: If server returns `DUPLICATE_SESSION`, display warning informing the user to close the duplicate tab.

## TEST REQUIREMENTS
- Vitest unit tests: Run `pnpm test` for store mutations, drift calculations, and stage layouts.
- Typecheck: Run `pnpm exec tsc --noEmit` and `pnpm lint`.

## DO NOT
- DO NOT grant user permissions optimistically on the client without server confirmation.
- DO NOT remount `<LiveKitRoom>` or the stage grid when toggling camera filters.
- DO NOT use `any` or untyped JSON objects.

## DONE WHEN
- Components render without flicker or duplicate-mount bugs.
- Zustand stores update cleanly from server events without re-render cascades.
- `pnpm test` and `pnpm exec tsc --noEmit` pass with zero errors.
