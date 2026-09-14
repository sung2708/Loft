# Skill: Canonical Room State & Lifecycle Management

## WHEN TO USE THIS SKILL
Use this skill whenever modifying in-memory room state structures, monotonic state versioning, participant membership maps, room snapshot serialization, room admission caps, or room eviction timers.

## SOURCE OF TRUTH
- **Durable Metadata & Messages**: PostgreSQL (`rooms`, `profiles`, `messages`).
- **Active Ephemeral Room & Playback Authority**: Go In-Memory Hub (`roomState` in `backend/internal/realtime/hub.go`).
- **Distributed Presence**: Redis key leases (`presence:room:<room_id>:*`).
- **Client Presentation State**: Client Zustand stores (`useRoomStore`, `useChatStore`, `useMusicStore`).

## ARCHITECTURAL BOUNDARIES
- Active room state is held in Go memory under `Hub.mu (sync.RWMutex)`.
- Mutations increment monotonic sequence numbers (`m.Version++`).
- Snapshot recovery overwrites client-local state upon reconnect.
- Database and network calls are strictly prohibited inside lock critical sections.

## REQUIRED WORKFLOW
1. **Acquire Mutex**:
   - Acquire `h.mu.Lock()` for writes or `h.mu.RLock()` for reads.
2. **Validate State & Version**:
   - Verify `command.ExpectedVersion == state.media.Version` to guard against concurrent split-brain mutations.
   - Return `errMediaStale` on mismatch.
3. **Execute In-Memory Mutation**:
   - Mutate `roomState` or `mediaState`.
   - Bump monotonic version (`m.Version++`).
   - Create detached snapshot copy by value (`state.media.snapshot()`).
4. **Release Mutex**:
   - Call `h.mu.Unlock()` or `h.mu.RUnlock()`.
5. **Non-Blocking Fan-Out**:
   - Broadcast serialized event to local client channels and Redis Pub/Sub outside the lock.

## IMPLEMENTATION RULES
- **Return Copies by Value**: Always create deep or value copies (`snapshot()`) of internal state slices/structs before releasing the lock. Never leak internal pointers.
- **Short Critical Sections**: Keep lock hold time strictly sub-millisecond ($<50\mu\text{s}$).
- **Eviction Timer**: When last participant leaves, schedule clean memory eviction after 10 minutes (`time.AfterFunc(10 * time.Minute, ...)`). If a user rejoins before timeout, cancel the eviction timer.

## FAILURE CASES
- **Stale Version Conflict**: Return typed error `MEDIA_COMMAND_REJECTED` with message `"media state changed; retry"`.
- **Duplicate Session**: If same user ID connects from a second tab, return `error: DUPLICATE_SESSION` and reject join to prevent state thrashing.
- **Room Full**: If active participants reach `max_participants` (default 12), reject admission with `error: ROOM_FULL`.

## TEST REQUIREMENTS
- Concurrency test: `go test -race ./internal/realtime/...`.
- Verify monotonic version increases by exactly 1 on each valid mutation.
- Test snapshot deserialization in frontend Zustand store tests (`useRoomStore.test.ts`).

## DO NOT
- DO NOT perform SQL queries or Redis I/O while holding `Hub.mu`.
- DO NOT allow client commands to overwrite state without checking `expected_version`.
- DO NOT leak mutable internal pointers outside the lock scope.

## DONE WHEN
- State transitions are race-free and pass with `-race`.
- `room.snapshot` delivers complete, valid state to joining clients.
- Empty rooms are evicted cleanly after the 10-minute grace period.
