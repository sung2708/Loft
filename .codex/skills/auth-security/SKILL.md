# Skill: Authentication, Authorization & Security Hardening

## Trigger
Use this skill whenever modifying authentication logic, token generation, permission evaluators, rate limiters, SSRF protections, CORS headers, WebSocket origin validation, or input sanitization.

## Goals
- Enforce the zero-trust client boundary across all HTTP and WebSocket endpoints.
- Centralize authorization decisions in domain functions (`CanKick`, `CanControlMedia`).
- Prevent Cross-Site WebSocket Hijacking (CSWSH), Server-Side Request Forgery (SSRF), and Injection attacks.

## Required reading
- [security.md](file:///d:/git/Loft/docs/security.md)
- [auth-and-permissions.md](file:///d:/git/Loft/docs/auth-and-permissions.md)
- [system-boundaries.md](file:///d:/git/Loft/docs/system-boundaries.md)

## Source of truth
- Authorization domain rules reside in `internal/permissions/evaluator.go`.

## Invariants
- Never trust client-provided `user_id`, `role`, or `permissions` fields.
- WebSocket handshakes must validate the `Origin` header against `ALLOWED_ORIGIN`.
- User-submitted media links must be strictly validated against whitelisted hostnames and provider regexes.
- Authorization checks must call centralized evaluator functions, never ad-hoc `role == "host"` checks in transport code.

## Workflow
1. For any new protected operation: define a domain evaluator method (e.g. `CanAssignModerator`).
2. Call the evaluator in the service layer using verified actor credentials.
3. Validate and sanitize input payloads (length limits, HTML escaping).
4. Apply action-specific rate limiting via `internal/platform/redis/limiter.go`.
5. Verify that error responses do not leak internal database errors or stack traces.

## Implementation rules
- **WHAT TO DO:** Use parameterized queries, regex ID extractors, and constant-time HMAC comparisons (`subtle.ConstantTimeCompare`).
- **WHAT NOT TO DO:** Never use raw string concatenation in queries or log raw authentication tokens.
- **WHY:** Prevents SQL injection, timing attacks, and credential leakage in monitoring platforms.
- **HOW TO VERIFY IT:** Run security unit tests and `govulncheck ./...`.

## Failure cases
- If rate limit is exceeded, return `429 Too Many Requests` with `Retry-After` header.
- If origin validation fails, reject WebSocket upgrade immediately with `403 Forbidden`.

## Security considerations
- All guest tokens must be room-scoped with strict expiration timestamps.
- Media URL parser must discard the raw URL and retain only validated `{ provider, media_id }`.

## Testing
- Test that a regular member or guest cannot execute moderator or host actions.
- Test SSRF protection against adversarial URLs (`http://169.254.169.254`, `http://localhost:5432`).
- Test WebSocket connection rejection when `Origin: http://malicious-site.com`.

## Verification
- Security test suite passes.
- No secrets or credentials found in git tracking or log outputs.

## Common mistakes
- Adding an `if role == "host"` check in an HTTP handler instead of calling `evaluator.CanChangeSettings()`.
- Trusting guest tokens across different rooms.

## Completion report
Upon finishing changes, summarize:
1. Authorization checks added or modified.
2. Rate limits and input validation verified.
3. Security unit and SSRF test results.
