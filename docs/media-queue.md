# Collaborative Media Queue Architecture — Mingly

This document specifies the data model, mutation operations, concurrency control, and validation rules for Mingly's collaborative media queue.

---

## 1. Stable Item Identity vs Array Indices

**Cardinal Invariant**: Queue mutations must **never** identify tracks by raw array index (e.g. `items[3]`). Array indices are transient and shift whenever items are added, removed, or reordered concurrently.

Every queued track is assigned an immutable UUIDv4 upon entry:

```go
type YouTubeTrack struct {
    ID          string `json:"id"`                 // Immutable UUIDv4 assigned by server
    VideoID     string `json:"video_id"`           // Validated 11-char YouTube ID
    AddedBy     string `json:"added_by"`           // Display name of contributor
    Title       string `json:"title,omitempty"`    // Sanitized video title (max 140 chars)
    Channel     string `json:"channel,omitempty"`  // Sanitized channel name (max 80 chars)
    DurationSec int64  `json:"duration_sec"`       // Video duration in seconds
}
```

---

## 2. Queue Operations & Authorizations

Queue operations are divided into **Member Contributions** (open to all admitted participants) and **Playback Flow Controls** (restricted to the room host):

| Operation | Protocol Event | Authorization | Parameters | Behavior |
| :--- | :--- | :---: | :--- | :--- |
| **Add Track** | `queue.add` | Any Member (`CanManageQueue`) | `url`, `title`, `channel` | Validates YouTube URL, creates track with new UUID. If queue was empty, sets as `current`; else appends to `queue`. Bumps `version++`. |
| **Remove Track** | `queue.remove` | Any Member | `track_id`, `expected_version` | Locates track by UUID; removes from queue. Bumps `version++`. |
| **Reorder Queue** | `queue.reorder` | Any Member | `order: []string`, `expected_version` | Verifies `order` is a strict permutation of existing track UUIDs; applies new sequence. Bumps `version++`. |
| **Select Track** | `queue.select` | Host Only (`CanControlMedia`) | `track_id`, `expected_version` | Moves selected track from queue to `current`; starts playback immediately. Bumps `version++`. |
| **Next Track** | `queue.next` | Host Only | `expected_version` | Advances queue: pops first queued item to `current`. If queue empty, sets `status = IDLE`. Bumps `version++`. |
| **Previous Track** | `queue.prev` | Host Only | `expected_version` | Re-cues active track to `position_ms = 0` (or restores previous track if history enabled). |
| **Clear Queue** | `queue.clear` | Host Only | `expected_version` | Empties `queue` slice; keeps active `current` track playing. Bumps `version++`. |
| **Shuffle Queue** | `queue.shuffle` | Any Member | `expected_version` | Deterministically pseudo-randomly permutes queued items. Bumps `version++`. |

---

## 3. Optimistic Concurrency Control (No CRDT)

Mingly explicitly rejects CRDTs (Conflict-Free Replicated Data Types) and Operational Transformation (OT) for media queues in MVP 2:
- **Why No CRDT**: CRDTs introduce massive complexity (tombstones, vector clocks, state blowup) that is completely unjustified for a 12-person social room with a 50-track maximum queue.
- **The Optimistic Version Solution**:
  - The server maintains monotonic sequence counter `MediaState.Version`.
  - Every mutating command must supply `expected_version`.
  - If two users submit simultaneous mutations (e.g. User A reorders while User B deletes track X):
    1. First arrived command succeeds: server mutates in-memory slice, bumps `version++`, and broadcasts full `media.state`.
    2. Second arrived command is rejected with `errMediaStale` (`MEDIA_COMMAND_REJECTED: media state changed; retry`).
    3. The rejected client receives the latest `media.state` broadcast automatically and its UI re-renders the current queue state.

---

## 4. Reorder Permutation Validation Algorithm

When processing `queue.reorder`, the Go server strictly validates that the proposed ordering is an exact 1-to-1 permutation of the existing queued IDs to prevent item duplication or deletion:

```go
func (m *mediaState) reorder(order []string) error {
    if len(order) != len(m.Queue) {
        return errInvalidMedia
    }
    idMap := make(map[string]youtubeTrack, len(m.Queue))
    for _, t := range m.Queue {
        idMap[t.ID] = t
    }
    newQueue := make([]youtubeTrack, 0, len(m.Queue))
    for _, id := range order {
        t, exists := idMap[id]
        if !exists {
            return errInvalidMedia // Missing or foreign track ID
        }
        newQueue = append(newQueue, t)
        delete(idMap, id) // Guarantees no duplicates
    }
    m.Queue = newQueue
    m.Version++
    return nil
}
```

---

## 5. Security & Input Sanitization

1. **Strict URL Parsing**: URLs must parse as HTTPS, hostname matching `youtube.com`, `www.youtube.com`, `m.youtube.com`, or `youtu.be`, extracting exactly 11 base64/URL-safe runes.
2. **Title & Channel Truncation**: Video titles are capped at 140 runes; channel names are capped at 80 runes.
3. **Queue Capacity Limit**: The queue enforces a hard maximum of 50 items. Additions exceeding 50 return `errQueueFull`.
4. **Rate Limiting**: Queue mutations are throttled to 10 operations per minute per participant to prevent denial-of-service spam.

---

## 6. Related Documentation
- [Media Synchronization Engine](file:///d:/git/Mingly/docs/media-sync.md)
- [Authentication & Permissions Architecture](file:///d:/git/Mingly/docs/auth-and-permissions.md)
- [Realtime Protocol Specification](file:///d:/git/Mingly/docs/realtime-protocol.md)
- [ADR-008: Server-Authoritative Shared Media State](file:///d:/git/Mingly/docs/adr/README.md#adr-008-server-authoritative-shared-media-state-with-timestamp-prediction)
- [ADR-009: Official YouTube Client Embed](file:///d:/git/Mingly/docs/adr/README.md#adr-009-official-youtube-client-embed-zero-backend-restreaming)
