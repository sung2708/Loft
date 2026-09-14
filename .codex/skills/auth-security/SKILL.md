# Skill: Authentication, Authorization & Security Hardening

## WHEN TO USE THIS SKILL
Use this skill whenever modifying token verification, guest identity signing, server-side permission evaluation, WebSocket origin validation, rate limiters, SSRF protection, or input sanitization.

## SOURCE OF TRUTH
- **Permanent User Identity**: Supabase Auth (JWT). Verified via `backend/internal/auth/supabase.go`.
- **Guest Identity**: HMAC-SHA256 tokens minted and verified via `backend/internal/auth/guest.go`.
- **Domain Authorization**: Centralized domain functions in `backend/internal/domain/domain.go`.

## ARCHITECTURAL BOUNDARIES
- Zero-trust boundary: The client never declares roles or permissions.
- Every privileged WebSocket command or REST endpoint evaluates server-side capabilities (`CanJoin`, `CanControlMedia`, `CanManageQueue`, `CanDeleteRoom`).
- Sensitive tokens and secrets are **never** logged or echoed back to clients.

## REQUIRED WORKFLOW
1. **Verify Token Cryptographically**:
   - For users: Verify Supabase JWT claims (`sub`, `iss`, `aud`, `exp`).
   - For guests: Verify HMAC-SHA256 signature, expiration (12 hours), and matching room ID.
2. **Evaluate Authorization Centralized**:
   - Call domain evaluator functions in `internal/domain/` (e.g. `CanControlMedia(room, actor)`).
   - Never write raw `if role == "host"` scattered in transport code.
3. **Validate WebSocket Origin**:
   - Check request `Origin` against `FRONTEND_ORIGINS`. Reject untrusted origins with `403 Forbidden`.
4. **Sanitize Inputs & Prevent SSRF**:
   - YouTube links must be HTTPS and parse strictly into valid 11-char IDs from `youtube.com` or `youtu.be`.
   - Never fetch arbitrary user-submitted URLs from the Go backend.
   - Truncate chat messages to $\le 2000$ runes; display names to $\le 48$ runes.
5. **Enforce Rate Limits**:
   - Connection attempts: 20 / min.
   - Chat: 5 msgs / 3s.
   - Reactions: 4 / 2s per user, 20 / 2s per room.
   - Media commands: 10 / 10s. Queue: 10 / min.

## IMPLEMENTATION RULES
- Always use constant-time comparisons (`subtle.ConstantTimeCompare`) for cryptographic HMAC signatures.
- Always use parameterized queries with `pgx`; never concatenate strings in SQL.
- Redact tokens, passwords, and secrets from all `slog` calls.

## FAILURE CASES
- **Invalid Origin**: Return `403 Forbidden` and abort WebSocket upgrade.
- **Unauthorized Action**: Return `error` event with code `MEDIA_COMMAND_REJECTED` or `UNAUTHORIZED`.
- **Rate Limit Hit**: Return `error` event with code `RATE_LIMITED` or HTTP 429.

## TEST REQUIREMENTS
- Unit tests in `internal/auth/` verifying valid, expired, tampered, and wrong-room tokens.
- Domain authorization tests in `internal/domain/domain_test.go` verifying capability isolation between hosts, members, and guests.

## DO NOT
- DO NOT trust role claims sent in WebSocket payloads.
- DO NOT permit guest tokens issued for Room A to authenticate into Room B.
- DO NOT perform outbound HTTP requests to user-supplied URLs (SSRF risk).
- DO NOT log bearer tokens or API secrets.

## DONE WHEN
- All privileged endpoints evaluate centralized domain functions.
- Untrusted origins and tampered tokens are rejected with 401/403.
- Rate limit buckets prevent command flooding.
