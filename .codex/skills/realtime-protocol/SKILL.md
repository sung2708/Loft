# Skill: Realtime Protocol Design & Codecs

## Trigger
Use this skill whenever adding, updating, or deprecating WebSocket protocol events, payload schemas, event envelopes, or client-server message types.

## Goals
- Enforce strict typing across Go backend and TypeScript frontend.
- Maintain the versioned canonical envelope (`protocol_version: 1`).
- Prevent untyped dynamic blobs (`map[string]interface{}` or `any`).

## Required reading
- [realtime-protocol.md](file:///d:/git/Loft/docs/realtime-protocol.md)
- [api-conventions.md](file:///d:/git/Loft/docs/api-conventions.md)

## Source of truth
- Canonical event schema specifications in [realtime-protocol.md](file:///d:/git/Loft/docs/realtime-protocol.md).
- Go types in `internal/realtime/protocol.go`.
- TypeScript types in `frontend/src/types/protocol.ts`.

## Invariants
- Every event belongs to a documented family (`connection.*`, `room.*`, `media.*`, `chat.*`, etc.).
- Every event envelope must include `type`, `protocol_version`, `event_id`, and `sent_at`.
- Payloads must deserialize into explicit Go structs and TypeScript discriminated unions.

## Workflow
1. Document the event definition in `docs/realtime-protocol.md` (direction, auth, authorization, schema, idempotency).
2. Add typed Go struct in `backend/internal/realtime/protocol.go`.
3. Add corresponding TypeScript discriminated union variant in `frontend/src/types/protocol.ts`.
4. Register the event handler in the Go router switch statement.
5. Add unit tests verifying JSON roundtrip serialization and schema validation.

## Implementation rules
- **WHAT TO DO:** Define concrete struct fields with JSON tags (`json:"position_ms"`).
- **WHAT NOT TO DO:** Never use `map[string]interface{}` or dynamic string-keyed dictionaries for protocol messages.
- **WHY:** Untyped payloads cause silent deserialization errors, broken client state, and vulnerability to prototype pollution.
- **HOW TO VERIFY IT:** Run `go test ./internal/realtime/...` and `npm run typecheck` in frontend.

## Failure cases
- If an unknown event type or invalid JSON is received, respond with `system.error` containing code `INVALID_PAYLOAD` and do not crash the socket.

## Security considerations
- Enforce payload size limits (<64KB) before deserializing.
- Sanitize user-submitted text fields before broadcasting.

## Testing
- Unit test envelope serialization and deserialization.
- Test rejection of malformed JSON and unsupported `protocol_version`.

## Verification
- Both Go test suite and TypeScript compilation succeed with zero type errors.

## Common mistakes
- Adding a field in Go without updating the matching TypeScript type definition.
- Emitting client-local UI state (e.g. drawer toggle) across the server protocol.

## Completion report
Upon finishing changes, summarize:
1. Event type and direction introduced.
2. Go struct and TypeScript union variant added.
3. Serialization tests verified.
