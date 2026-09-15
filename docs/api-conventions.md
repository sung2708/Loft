# REST API Conventions & Error Standards — Loft

## 1. Protocol Responsibility Separation

To preserve system clarity, operations are cleanly separated between REST and WebSocket:

- **Use HTTP REST for:**
  - Authentication bootstrap & guest token generation.
  - Persistent resource lifecycle: Room creation, updating room settings, deleting rooms.
  - Generating and validating invitation links.
  - Paginated durable query reads: Historical chat messages, audit logs, ban records.
  - LiveKit access token requests when joining rooms.
  - Health and readiness probes (`/healthz`, `/readyz`).
- **Use WebSocket for:**
  - Realtime room event broadcasting (chat, presence, media synchronization).
  - High-frequency low-latency commands (play, pause, seek, reaction).

> **Rule:** Do not move ordinary CRUD operations into WebSocket frames simply because a socket is open. REST offers better caching, idempotency, rate limiting, and observability for request-response flows.

---

## 2. Standardized Error Response Format

All HTTP error responses return a standardized JSON envelope with stable machine-readable error codes:

```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "The requested room does not exist or has been deleted.",
    "details": {
      "room_id": "c73d9e84-1b72-4d26-9f4a-71829e81b674"
    }
  }
}
```

### Security & Information Disclosure Policy
- Internal errors (`500 Internal Server Error`) **must never** return raw database error strings, SQL queries, or internal stack traces to the client.
- The server logs the full error context and stack trace internally with the `request_id`, returning only:
  ```json
  {
    "error": {
      "code": "INTERNAL_SERVER_ERROR",
      "message": "An unexpected error occurred. Please contact support if the issue persists."
    }
  }
  ```

---

## 3. Machine-Readable Error Code Catalog

| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| `400 Bad Request` | `INVALID_PAYLOAD` | Request body failed JSON decoding or field validation. |
| `401 Unauthorized` | `UNAUTHORIZED` | Missing, expired, or malformed JWT / Guest token. |
| `403 Forbidden` | `ROOM_ACCESS_DENIED` | Caller cannot enter the target room or request media access. |
| `403 Forbidden` | `ROOM_KICKED` | Identity has a durable ban in the target room. |
| `404 Not Found` | `ROOM_NOT_FOUND` | Room ID or slug does not exist. |
| `404 Not Found` | `INVITE_EXPIRED` | Invitation code does not exist or has reached max uses / expiry. |
| `409 Conflict` | `ROOM_BUSY` | Room has active participants or another delete is in progress. |
| `429 Too Many Requests` | `RATE_LIMITED` | Exceeded allowed requests per time window. |
| `503 Service Unavailable` | `NOT_READY` / `LIVEKIT_TOKEN_FAILED` | A required dependency is unavailable. |
| `500 Internal Error` | `INTERNAL_ERROR` | Unhandled server exception. |

---

## 4. HTTP API Endpoint Catalog (v1)

### Authentication & Profiles
- `GET /api/v1/users/me` — Retrieve the current authenticated profile (`Authorization: Bearer <supabase-jwt>`).

### Rooms & Lifecycle
- `POST /api/v1/rooms` — Create a new room (Requires Auth).
  - Body: `{ "name": "Friday Chill", "allow_guests": true }`
  - Returns: Created room record with a unique six-digit public `slug`; the UUID `id` remains the internal identifier.
- `GET /api/v1/rooms` — List rooms owned by the authenticated user.
- `GET /api/v1/rooms/resolve?value=<room-id-or-invite-link>` — Resolve a UUID, six-digit code, or legacy invite link without exposing private fields.
- `GET /api/v1/rooms/{id}` — Fetch public room metadata.
- `DELETE /api/v1/rooms/{id}` — Terminate room (Host only).

### Guest Membership
- `POST /api/v1/rooms/{id}/guest-session` — Generate a room-scoped guest credential.
  - Body: `{ "display_name": "Cozy Beaver" }`
  - Returns: `{ "token": "...", "guest_id": "...", "display_name": "...", "room_id": "...", "expires_at": "..." }`

### Chat & History
- `GET /api/v1/rooms/{id}/messages` — Return the recent durable chat history for an admitted user or guest.

### LiveKit Media
- `POST /api/v1/rooms/{id}/livekit-token` — Request a scoped LiveKit token after WebSocket room admission.

### Infrastructure & Telemetry
- `GET /health` (`/healthz` alias) — Liveness probe (Returns `200 OK` if Go runtime is responsive).
- `GET /ready` (`/readyz` alias) — Readiness probe (Returns `200 OK` when PostgreSQL is reachable; Redis is optional and reported through degraded logs).
- `GET /metrics` — Prometheus metrics scrape endpoint. Keep this route behind an internal ingress or auth policy in production.
