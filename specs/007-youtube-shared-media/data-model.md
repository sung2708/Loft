# Data Model: YouTube Experience, Discovery & Shared Queue

## Existing authoritative entities

### MediaState

Current provider media, status, timestamp anchor, playback rate, version, and updater. Remains owned by Go room authority and projected through existing snapshots/events.

### QueueItem

Stable item ID, provider (`youtube`), provider video ID, safe title/channel/duration/thumbnail metadata, attribution, created time, and order. Provider ID deduplication is scoped to active room media/queue rules.

## New/extended entities

### RoomPick

`id`, `room_id`, `provider`, `provider_media_id`, safe metadata, `suggested_by`, `created_at`, `status`, and bounded vote count. Pick ID never becomes queue item ID.

### RoomPickVote

`pick_id`, stable participant/user identity, and created time. Unique per pick and participant; duplicate submissions are idempotent.

### RoomMediaSettings

Room-owned settings including `autoplay_suggestions` (default false). Only existing authorized room roles can mutate it; it is included in snapshots.

### SuggestedCandidate

Ephemeral bounded candidate with provider ID, safe metadata, source context, and expiry. It is never durable canonical playback until accepted by authority.

### MediaVisualContext

Frontend-only sanitized primary/secondary/accent/luminance values derived from a public thumbnail. It is not a security or room-authority field.

## Validation and transitions

- Provider IDs and URLs are validated against approved YouTube host/forms.
- Queue and pick mutations require membership/role checks and expected versions.
- Current → queued → playing → ended/unavailable transitions are authority-controlled.
- Autoplay may transition only from ended with an empty explicit queue and enabled room setting.
- Reconnect uses a fresh snapshot; no unbounded event history is retained.
