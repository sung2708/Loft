# Skill: Media Synchronization & Collaborative Queue

## WHEN TO USE THIS SKILL
Use this skill whenever modifying media playback state machines, anchor position calculations, drift correction algorithms, YouTube IFrame player integration, or collaborative queue mutations (`add`, `remove`, `reorder`, `select`, `clear`).

## SOURCE OF TRUTH
- **Authoritative Playback Anchor & Queue**: Go In-Memory Room Authority (`mediaState` in `backend/internal/realtime/media.go`).
- **Media Delivery & Hardware Decoding**: Official YouTube IFrame Player in the client's browser.
- **Client Playback State**: `useMusicStore` in `frontend/src/stores/useMusicStore.ts`.

## ARCHITECTURAL BOUNDARIES
- The server synchronizes **state only** (`position_ms`, `started_at`, `status`, `version`).
- The Go backend and WebSocket protocol **never** proxy, buffer, download, or restream YouTube video/audio bytes.
- Continuous playback position ticks are **never** broadcast over WebSockets; clients predict position using server timestamp anchors.

## REQUIRED WORKFLOW
1. **Timestamp Prediction Formula**:
   - Compute instantaneous position without server ticks:
     $$\text{PredictedPos} = \text{PositionMs} + (\text{Now} - \text{StartedAt}) \times \text{PlaybackRate} \quad (\text{if PLAYING})$$
2. **Server Media Mutation**:
   - Evaluate actor authority (`CanControlMedia` for play/pause/seek; `CanManageQueue` for additions).
   - Check `command.ExpectedVersion == media.Version`.
   - Update anchor `(PositionMs, StartedAt, Status)`, bump `Version++`, and broadcast `media.state`.
   - If `PLAYING` and duration is known, schedule server timer `mediaTimer` to automatically trigger queue advance at video conclusion.
3. **Collaborative Queue Mutations**:
   - Require stable UUIDv4 track IDs (never raw array indices).
   - Validate `queue.reorder` as an exact 1-to-1 permutation of queued track IDs.
   - Cap queue length at 50 items.
4. **Client Drift Correction**:
   - Compare local YouTube player position ($P_{\text{local}}$) against predicted anchor ($P_{\text{predicted}}$).
   - $< 250\text{ms}$: Passive no-op.
   - $250\text{ms} - 1500\text{ms}$: Soft playback rate nudge ($0.95\times$ / $1.05\times$).
   - $> 1500\text{ms}$: Hard seek resync (`player.seekTo`).

## IMPLEMENTATION RULES
- **Zero Restreaming**: Always embed YouTube's official player; never proxy video streams.
- **No Periodic Broadcast Ticks**: State updates broadcast **only** on state transitions (`play`, `pause`, `seek`, `next`, `queue mutation`).
- **Sanitize Input**: Strictly parse YouTube URLs, extracting the 11-character alphanumeric ID; truncate title to $\le 140$ runes and channel to $\le 80$ runes.

## FAILURE CASES
- **Stale Command**: If `expected_version != m.Version`, reject mutation with `errMediaStale`.
- **Blocked Embedded Playback**: If YouTube player fires error 101/150, notify room authority to advance to next queued track.
- **Clock Skew**: Calibrate client-server clock offset via `connection.ping` / `connection.pong` roundtrip.

## TEST REQUIREMENTS
- **Unit**: Test position math in `internal/realtime/media_test.go` across pause, play, seek, and canonical end scenarios.
- **Permutation Test**: Verify `queue.reorder` rejects invalid, duplicate, or missing track IDs.
- **Vitest**: Verify `mediaClock.test.ts` drift calculations.

## DO NOT
- DO NOT broadcast `currentTime` every second or every frame.
- DO NOT write continuous playback progress to PostgreSQL.
- DO NOT identify queued items by transient array indices.
- DO NOT introduce CRDT complexity for a 50-item media queue.

## DONE WHEN
- YouTube playback stays synchronized within $\pm 250\text{ms}$ across 4 concurrent clients.
- Queue additions, reorders, and skips resolve deterministically with monotonic versioning.
- Video ends advance the queue automatically on schedule.
