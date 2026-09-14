# Skill: Frontend Next.js, TypeScript & Zustand Architecture

## Trigger
Use this skill whenever modifying Next.js components, Zustand state stores, custom hooks, WebSocket client services, LiveKit client hooks, or player integration adapters in `frontend/`.

## Goals
- Maintain strict separation across Zustand state slices (Server state vs. Local UI state).
- Enforce the explicit connection finite state machine (`DISCONNECTED` -> `CONNECTING` -> `AUTHENTICATING` -> `CONNECTED` -> `RECONNECTING` -> `RESYNCING`).
- Implement drift correction math accurately without player stutter.
- Ensure strict TypeScript typing with zero `any` usage.

## Required reading
- [frontend-plan.md](file:///d:/git/Loft/docs/frontend-plan.md)
- [realtime-protocol.md](file:///d:/git/Loft/docs/realtime-protocol.md)
- [media-sync.md](file:///d:/git/Loft/docs/media-sync.md)

## Source of truth
- Authoritative room state is mirrored into `useRoomStore` from server `room.snapshot`.
- Local UI preferences (drawer open, volume) reside in `useUIStore`.

## Invariants
- The frontend is **never** authoritative for security, permissions, or room state.
- Never declare boolean soups (`isLoading && isConnecting && !isReady`); use the explicit connection state enum.
- Protocol events must deserialize into TypeScript discriminated unions.
- Components must subscribe to granular store selectors (e.g. `useRoomStore(s => s.hostId)`) to avoid full-tree rerenders.

## Workflow
1. For state changes: define slice state and actions in `frontend/src/stores/`.
2. For realtime events: handle incoming message in `services/websocket.ts` and dispatch to target store.
3. For components: use Lucide for icons and Tailwind CSS for styling.
4. Run `pnpm lint` and `pnpm typecheck` to verify strict typing.

## Implementation rules
- **WHAT TO DO:** Use selector functions with `useShallow` or atomic primitives when reading from Zustand.
- **WHAT NOT TO DO:** Never use `any` for event payloads or store slices.
- **WHY:** Untyped payloads break refactoring safety and cause runtime exceptions in edge cases.
- **HOW TO VERIFY IT:** Run `pnpm typecheck`.

## Failure cases
- If the WebSocket connection drops, immediately transition state to `RECONNECTING`, trigger exponential backoff, and notify the user via a subtle status indicator.

## Security considerations
- Sanitize rendered markdown chat content using `DOMPurify`.
- Never store raw credentials or service role keys in `localStorage`.

## Testing
- Write unit tests for Zustand store actions and drift calculation math.
- Test connection state transitions using mock WebSocket servers.

## Verification
- Frontend builds cleanly via `pnpm build` with zero warnings.
- Components render without React strict mode duplicate-effect bugs.

## Common mistakes
- Triggering infinite loops by dispatching WebSocket messages inside React `useEffect` without proper dependency arrays.

## Completion report
Upon finishing changes, summarize:
1. Components or stores modified.
2. Store selector granularity and rerender performance verified.
3. TypeScript validation and build test output.
