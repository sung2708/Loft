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
| `401 Unauthorized` | `AUTHENTICATION_REQUIRED` | Missing, expired, or malformed JWT / Guest token. |
| `403 Forbidden` | `PERMISSION_DENIED` | Caller lacks required capability (e.g. non-host altering room settings). |
| `403 Forbidden` | `USER_BANNED` | User is banned from entering the target room. |
| `404 Not Found` | `ROOM_NOT_FOUND` | Room ID or slug does not exist. |
| `404 Not Found` | `INVITE_EXPIRED` | Invitation code does not exist or has reached max uses / expiry. |
| `409 Conflict` | `STALE_VERSION` | Optimistic lock conflict; caller must re-fetch snapshot. |
| `429 Too Many Requests` | `RATE_LIMIT_EXCEEDED` | Exceeded allowed requests per time window. |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR`| Unhandled server exception. |

---

## 4. HTTP API Endpoint Catalog (v1)

### Authentication & Profiles
- `POST /api/v1/auth/guest` — Generate room-scoped guest token.
  - Body: `{ "room_slug": "friday-hangout", "display_name": "Cozy Beaver" }`
  - Returns: `{ "token": "...", "guest_id": "...", "display_name": "..." }`
- `GET /api/v1/users/me` — Retrieve current authenticated profile.

### Rooms & Lifecycle
- `POST /api/v1/rooms` — Create a new room (Requires Auth).
  - Body: `{ "name": "Friday Chill", "is_private": true, "passcode": "optional" }`
  - Returns: Created room record with unique slug.
- `GET /api/v1/rooms/{id}` — Fetch public room metadata.
- `PATCH /api/v1/rooms/{id}` — Update room settings (Requires `can_change_room_settings`).
- `DELETE /api/v1/rooms/{id}` — Terminate room (Host only).

### Invites & Membership
- `POST /api/v1/rooms/{id}/invites` — Generate invite link with optional expiry & usage limits.
- `GET /api/v1/invites/{code}` — Resolve invite code to room slug and name.

### Chat & History
- `GET /api/v1/rooms/{id}/messages?cursor={timestamp}&limit=50` — Cursor-paginated chat history.

### LiveKit Media
- `GET /api/v1/rooms/{id}/livekit-token` — Request scoped media token.

### Infrastructure & Telemetry
- `GET /healthz` — Liveness probe (Returns `200 OK` if Go runtime is responsive).
- `GET /readyz` — Readiness probe (Returns `200 OK` only if PostgreSQL and Redis connections are healthy).
- `GET /metrics` — Prometheus metrics scrape endpoint (Protected / internal network only).
