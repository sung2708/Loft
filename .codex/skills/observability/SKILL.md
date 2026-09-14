# Skill: Observability, Metrics & Structured Logging

## WHEN TO USE THIS SKILL
Use this skill whenever adding or modifying structured logs, domain metrics, latency timers, error counters, request tracing context, or telemetry collectors.

## SOURCE OF TRUTH
- **Structured Logger**: Standard library `log/slog`.
- **Metrics Specifications**: [observability.md](file:///d:/git/Loft/docs/observability.md).

## ARCHITECTURAL BOUNDARIES
- All logs are formatted as JSON using `slog`. Plaintext formatting (`fmt.Println`, `log.Printf`) is strictly prohibited.
- **Zero High-Cardinality Labels**: Dynamic UUIDs (`room_id`, `user_id`, `event_id`, `connection_id`) belong in **logs only**, never as Prometheus metric labels.
- Security boundary: Authentication tokens, passwords, and secrets are strictly redacted.

## REQUIRED WORKFLOW
1. **Inject Structured Correlation Context**:
   - Every log call must include relevant contextual dimensions:
     ```go
     h.logger.Info("websocket joined",
         "request_id", reqID,
         "room_id", room.ID,
         "connection_id", c.id,
         "participant_id", identity.LiveKitIdentity(),
         "instance_id", h.instanceID,
     )
     ```
2. **Instrument Low-Cardinality Metrics**:
   - Use fixed, low-cardinality labels only (`method`, `status_code`, `event_family`, `identity_type`).
   - Observe durations using `prometheus.NewTimer()`.
3. **Audit Log Payloads**:
   - Ensure error messages and payload dumps do not leak Supabase JWTs or guest tokens.

## IMPLEMENTATION RULES
- **No Vanity Metrics**: Every registered metric must answer an actionable operational question (e.g. slow client drop rate, broadcast latency, DB error rate).
- **Log Levels**:
  - `INFO`: Normal lifecycle events (joins, leaves, room created).
  - `WARN`: Degradations (slow client dropped, rate limit hit, tier step-down).
  - `ERROR`: System failures (database error, Redis disconnect, unhandled panic).

## FAILURE CASES
- If Prometheus collector fails or metric registry panics: Catch and log error. Telemetry must never crash business logic.

## TEST REQUIREMENTS
- Unit test verifying logger outputs valid JSON with expected keys.
- Metric test verifying label values belong to bounded enum sets.

## DO NOT
- DO NOT use dynamic UUIDs (`room_id`, `user_id`, `event_id`) as Prometheus metric labels.
- DO NOT log Bearer tokens, passwords, or guest HMAC secrets.
- DO NOT use unstructured log statements in production packages.

## DONE WHEN
- All logs parse as valid JSON carrying `room_id` and `connection_id` context.
- Metric vectors maintain bounded cardinality.
- Zero secrets are leaked in logs.
