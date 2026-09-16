# Security & Threat Model — Loft

## 1. Security Philosophy: Zero-Trust Client Boundary

In Loft, the browser frontend is treated as an untrusted environment.
1. **Never Trust Client Assertions:** The server never accepts client-provided user IDs, roles, or permissions. All state actions are evaluated against verified cryptographic tokens.
2. **Strict Origin & Transport Security:** All traffic requires TLS in production (`wss://` and `https://`). Cross-Site WebSocket Hijacking (CSWSH) is prevented via strict origin validation.
3. **Secret Isolation:** LiveKit API secrets, database credentials, and HMAC keys exist solely in the Go backend environment and are **never** delivered to client bundles.

---

## 2. Authentication & Cryptographic Verification

### Supabase JWT Verification
- Go backend pulls JWKS keys from Supabase and caches them in memory.
- Verifies RSA/ECDSA signatures, expiry (`exp`), and audience (`aud`).
- Maps `sub` claim to internal `user_id`.

### Guest Token Security (HMAC-SHA256)
Guest tokens allow instant participation without account creation while preventing spoofing:
- **Format:** `base64url(payload).base64url(hmac)`
- **Payload:** `{ "guest_id": "...", "room_id": "...", "name": "...", "exp": 1789389200 }`
- **Room-Scoped Invariant:** A guest token is cryptographically bound to a single `room_id`. Using a token minted for Room A in Room B fails authorization immediately.

---

## 3. WebSocket Security & Origin Enforcement (Anti-CSWSH)

Because WebSockets do not adhere to standard browser Same-Origin Policy during handshake:
```go
func checkOrigin(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    if origin == "" {
        return false // Reject requests without origin
    }
    u, err := url.Parse(origin)
    if err != nil {
        return false
    }
    // Strict whitelist check
    return u.Host == config.AllowedFrontendHost
}
```

---

## 4. Media Link Validation & SSRF Prevention

Users submit media links (YouTube, Spotify, SoundCloud) to the shared queue. The server **never** fetches arbitrary URLs submitted by clients.

### URL Validation & Normalization Pipeline
1. **Strict Hostname Whitelist:**
   - YouTube: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`
   - Spotify: `open.spotify.com`
   - SoundCloud: `soundcloud.com`, `m.soundcloud.com`
2. **Provider ID Extraction via Regex:**
   - YouTube Video ID: `^[a-zA-Z0-9_-]{11}$`
   - Spotify Track ID: `^[a-zA-Z0-9]{22}$`
3. **Stored Representation:** The database and queue store **only** `{ provider: "youtube", media_id: "dQw4w9WgXcQ" }`. The raw user URL is discarded.

### SSRF Protection Policy
If server-side metadata scraping or oEmbed lookups are ever added:
- The HTTP client must validate DNS resolution against private IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`).
- Redirects (`CheckRedirect`) must be intercepted and re-validated against the private IP blocklist.

---

## 5. Granular Action Rate Limiting

Rate limiting is enforced by specific action and identity, preventing denial-of-service and brute force abuse:

| Action | Identity Scope | Limit | Window | Action on Violation |
| :--- | :--- | :--- | :--- | :--- |
| **Room Creation** | Authenticated User | 5 Rooms | 1 Minute | HTTP `429 Too Many Requests` |
| **Guest Token Minting** | Client IP | 20 Tokens | 1 Minute | HTTP `429 Too Many Requests` |
| **WebSocket Connections**| Client IP | 10 Handshakes| 1 Minute | HTTP `429 Too Many Requests` |
| **Chat Messages** | User / Guest | 5 Messages | 3 Seconds | WS `system.error (RATE_LIMITED)` |
| **Reactions** | User / Guest | 15 Emojis | 5 Seconds | Dropped silently |
| **Media Commands (Play/Seek)**| User / Guest | 10 Commands | 10 Seconds | WS `system.error (RATE_LIMITED)` |
| **Queue Mutations** | User / Guest | 10 Additions | 1 Minute | WS `system.error (RATE_LIMITED)` |
| **Moderator Actions** | Moderator | 15 Actions | 1 Minute | Logged + `429` error |

---

## 6. XSS Prevention & Safe Message Rendering

- **Markdown Sanitization:** Client uses strict markdown rendering with HTML tags disabled. If rich text or raw HTML is rendered, it must pass through `DOMPurify` with disallowed `<script>`, `<iframe>`, and `javascript:` URIs.
- **Content-Security-Policy (CSP):** HTTP headers restrict script sources to self and trusted CDNs, frame-ancestors to none, and media sources to authorized CDNs.

---

## 7. Structured Logging & Secret Redaction

Logs must never leak sensitive tokens, passwords, or PII:
```go
// Logger automatically redacts sensitive fields
var redactedKeys = map[string]bool{
    "token": true, "password": true, "secret": true,
    "authorization": true, "livekit_token": true,
}
```

Room passwords are accepted only during the server-side guest admission flow. They are stored only
as a one-way verifier, never included in invite URLs, room previews, snapshots, logs, or metrics.
Failed password attempts use bounded temporary rate limits and return generic user-facing errors.
Any logged attribute matching these keys is replaced with `"[REDACTED]"`.

## 8. Host moderation boundaries

- Current realtime host authority is checked in the Go Hub; the client role is
  presentation only.
- Host transfer targets are authenticated connected participants. Guests are
  not promoted to host because their room-scoped identity is weaker.
- Kick and temporary-ban writes are room-scoped. Temporary bans expire in
  PostgreSQL and are checked again during WebSocket and LiveKit admission.
- Stale connection generations and exact connection IDs are required for
  cleanup, so an old socket cannot remove or restore a newer session.

## 9. Room Appearance privacy boundary

The server accepts only closed semantic atmosphere and accent values plus a boolean adaptive preference. It rejects arbitrary CSS, colors, and URLs. Derived palettes stay in browser memory and are never uploaded, logged, persisted, included in snapshots, or relayed through Redis. Personal `light|dark|system` preference and the compatibility-sensitive `loft.theme` key remain client-owned.
