# Skill: Supabase Authentication & RLS Boundaries

## Trigger
Use this skill whenever modifying Supabase client integration, JWT verification logic in Go, Supabase JWKS caching, user profile synchronization, or PostgreSQL Row-Level Security (RLS) policies.

## Goals
- Maintain robust JWT verification without trusting client-asserted claims.
- Enforce that Supabase acts as authentication infrastructure, while Go owns authorization.
- Ensure strict RLS policies prevent direct client tampering with room permissions or roles.

## Required reading
- [auth-and-permissions.md](file:///d:/git/Loft/docs/auth-and-permissions.md)
- [database.md](file:///d:/git/Loft/docs/database.md)
- [security.md](file:///d:/git/Loft/docs/security.md)

## Source of truth
- User identity accounts belong to Supabase Auth (`auth.users`).
- Application roles, room permissions, and moderation belong to PostgreSQL via Go domain authority.

## Invariants
- The Go backend **never** trusts client-declared user IDs; identity must come from verified JWT `sub`.
- The frontend **never** writes directly to `rooms`, `room_memberships`, or `room_bans` using Supabase client; all mutations route through Go.
- JWKS keys must be cached in memory with periodic background refresh to prevent per-request external network trips.

## Workflow
1. For incoming HTTP requests: extract `Bearer <token>` header in `internal/auth/middleware.go`.
2. Verify token signature against cached Supabase JWKS.
3. Validate expiration (`exp`) and audience (`aud == "authenticated"`).
4. Extract `sub` (UUID) and attach to `r.Context()`.
5. For database RLS: verify policies restrict `UPDATE` and `DELETE` on room tables to service role only.

## Implementation rules
- **WHAT TO DO:** Cache Supabase JWKS keys with a 1-hour TTL.
- **WHAT NOT TO DO:** Never call Supabase Auth REST API on every WebSocket message.
- **WHY:** High-frequency external HTTP calls introduce latency spikes and risk rate-limiting by Supabase.
- **HOW TO VERIFY IT:** Run auth middleware benchmark tests.

## Failure cases
- If Supabase Auth is unreachable, existing cached JWKS continue validating active sessions.
- Expired or tampered tokens return HTTP `401 / AUTHENTICATION_REQUIRED`.

## Security considerations
- Never expose the Supabase `service_role` key to the frontend client bundle.
- Ensure `profiles` table has RLS enabled with `SELECT` allowed for authenticated users and `UPDATE` allowed only for self (`auth.uid() = id`).

## Testing
- Unit test JWT parser with valid, expired, and forged tokens.
- Verify RLS policies using Supabase SQL test harness.

## Verification
- Valid JWT correctly populates user context in handlers.
- Tampered JWT is immediately rejected.

## Common mistakes
- Trusting the `role` claim in the Supabase JWT as an application room role (Supabase JWT `role` is just `"authenticated"`; room roles reside in `room_memberships`).

## Completion report
Upon finishing changes, summarize:
1. Token validation and JWKS caching changes.
2. RLS policies updated or validated.
3. Auth middleware unit test results.
