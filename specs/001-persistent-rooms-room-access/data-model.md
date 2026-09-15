# Data Model: Persistent Rooms & Room Access

## Persistent Room

The existing `rooms` record remains the durable source of truth.

| Field | Purpose | Rules |
|---|---|---|
| `id` | Internal stable room identity | Never exposed as secret authorization material; existing UUID compatibility remains supported |
| `short_code` / legacy `invite_code` | Public lookup identity | Reusable in invite paths; preserve existing resolution behavior |
| `name` | Owner-managed room name | Existing trimmed 2–80 character validation |
| `owner_id` | Durable owner | Authenticated creator; owner-only settings and lifecycle actions |
| `allow_guests` | Whether guest joining is permitted | Existing guest-first policy; independent from password protection |
| `password_required` | Whether a password is required | Public preview may expose only this boolean |
| `password_verifier` | One-way verifier for room password | Nullable when unprotected; never returned to clients or logs |
| `max_participants` | Room capacity | Preserve existing 2–12 product constraint |
| `is_locked` | Temporary admission lock | Existing participants remain; new admission is denied |
| `version` | Optimistic concurrency version | Increment for every accepted persistent access/settings mutation |
| `lifecycle_state` | Availability for future-proofing | Existing implementation may use present/deleted semantics; do not add archive unless explicitly required |
| `created_at`, `updated_at` | Durable lifecycle timestamps | Update `updated_at` on successful settings changes |

## Room Access Policy

Conceptual policy returned to UI and included in authoritative room state:

```text
allow_guests: boolean
password_required: boolean
is_locked: boolean
version: integer
```

`password_required` is safe presentation state. `password_verifier` is server-only durable state.
The policy is evaluated in this order: room exists and is available; actor is not banned; room is
not locked for a new admission; guest access is allowed when actor is a guest; password is verified
when required; then a scoped room credential/session may be issued.

## Room Session / Presence

Room sessions remain ephemeral and separate from the persistent room:

- A session identifies an authenticated user or room-scoped guest.
- Presence follows existing heartbeat, duplicate-session, disconnect, and reconnect rules.
- A session ending MUST NOT alter durable room existence.
- Reconnect re-evaluates current policy and then receives a fresh authoritative snapshot.
- A durable member row or owner row is not proof that the identity is currently connected.

## Password Attempt Budget

The failed-password protection is an ephemeral coordination record, not durable room data.

- Keying and thresholds are policy-controlled and must avoid storing plaintext passwords.
- It tracks bounded failures and a temporary cooldown across backend instances.
- Successful verification and cooldown expiry restore legitimate retry behavior according to policy.
- Logs and metrics contain outcome/category and safe correlation data only, never password material or
  password-derived sensitive values.

## State Transitions

```text
PUBLIC ── owner enables password ──> PASSWORD_PROTECTED
PASSWORD_PROTECTED ── owner disables password ──> PUBLIC
PUBLIC/PASSWORD_PROTECTED ── owner locks ──> LOCKED
LOCKED ── owner unlocks ──> PUBLIC or PASSWORD_PROTECTED
ANY AVAILABLE STATE ── owner confirms delete ──> DELETED/UNAVAILABLE
AVAILABLE ── participant leaves/disconnects ──> AVAILABLE (presence decreases only)
AVAILABLE ── temporary eviction ──> DURABLE AVAILABLE + no in-memory active state
```

Transitions are authorized by the owner, compare-and-swap on `version`, and persisted before any
cross-instance or realtime notification. A stale version returns a conflict and leaves policy
unchanged.

## Validation and Invariants

- Password-required rooms MUST have a valid verifier; public rooms MUST NOT retain an active verifier
  that can accidentally be used to bypass the selected policy.
- No client payload can set `owner_id`, role, `password_verifier`, or authorization success.
- Existing authenticated users can join according to current product rules; password protection is
  not equivalent to authenticated-only access unless a future policy explicitly adds that mode.
- A deleted/unavailable room cannot be recreated by lookup, invite, reconnect, or media-token request.
- Persistent room updates cannot occur while holding realtime mutexes; the authoritative update and
  subsequent broadcast are separate phases.
