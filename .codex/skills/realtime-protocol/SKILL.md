# Skill: Realtime Protocol Design & Codecs

## WHEN TO USE THIS SKILL
Use this skill whenever adding, updating, or deprecating WebSocket protocol events, payload schemas, event envelopes, or client-server message serialization.

## SOURCE OF TRUTH
- **Schema Specifications**: [realtime-protocol.md](file:///d:/git/Loft/docs/realtime-protocol.md).
- **Backend Envelopes**: `backend/internal/realtime/hub.go` (`Envelope` struct).
- **Frontend Type Unions**: `frontend/src/types/api.ts` (`ServerEvent` discriminated union).

## ARCHITECTURAL BOUNDARIES
- All communication uses the canonical JSON Envelope (`type`, `version`, `event_id`, `room_id`, `payload`).
- Dynamic untyped payloads (`map[string]interface{}` or `any`) are strictly prohibited in Go handlers and TypeScript stores.
- Every state mutation must increment the room/media version or supply `expected_version`.

## REQUIRED WORKFLOW
1. **Document in Protocol Specification**:
   - Update `docs/realtime-protocol.md` with direction, validation, authorization, source of truth, and schema.
2. **Define Strongly Typed Go Struct**:
   - Define payload struct in `backend/internal/realtime/` with explicit JSON tags.
3. **Define TypeScript Discriminated Union Variant**:
   - Add new variant to `ServerEvent` in `frontend/src/types/api.ts`.
4. **Implement Backend Handler**:
   - Register event in `hub.readPump` switch statement.
   - Enforce rate limit bucket and domain capability authorization before processing.
5. **Add Automated Unit Tests**:
   - Test JSON roundtrip serialization and schema error handling in `backend/internal/realtime/hub_test.go`.

## IMPLEMENTATION RULES
- Event names must follow `noun.verb` format (e.g. `media.play`, `queue.reorder`, `room.lock`). Never use vague verbs like `update` or `sync`.
- Bounded payload size: The read pump enforces `conn.SetReadLimit(16 << 10)` (16KB max frame).
- Envelope field names: Must be `"version"` (int), `"event_id"`, `"room_id"`, `"payload"`. Never invent `"protocol_version"` or `"sequence"`.

## FAILURE CASES
- If an unsupported event type or malformed JSON is received: Dispatch `error` event with code `UNKNOWN_EVENT` or `INVALID_PAYLOAD`. Do not crash the socket or hub.

## TEST REQUIREMENTS
- Unit test envelope unmarshaling with valid, missing, and extra fields.
- Typecheck frontend (`pnpm exec tsc --noEmit`) to verify exhaustive union matching.

## DO NOT
- DO NOT use `any` or `map[string]interface{}` for payload representations.
- DO NOT send client-local UI state (drawer open/closed, volume level) across the WebSocket.
- DO NOT bypass the JSON envelope standard.

## DONE WHEN
- Event is documented in `realtime-protocol.md`.
- Go struct and TypeScript union variant are aligned character-for-character.
- `go test ./internal/realtime/...` and `pnpm exec tsc --noEmit` pass with zero errors.
