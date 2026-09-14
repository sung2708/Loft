# Skill: Observability, Metrics & Structured Logging

## Trigger
Use this skill whenever adding or modifying structured logs, Prometheus metrics, telemetry collectors, request tracing context, or pprof profiling endpoints.

## Goals
- Maintain consistent JSON structured logging via `slog`.
- Instrument latency, throughput, and error rates using Prometheus metrics.
- Prevent high-cardinality memory leaks in Prometheus metric collectors.

## Required reading
- [observability.md](file:///d:/git/Loft/docs/observability.md)
- [security.md](file:///d:/git/Loft/docs/security.md)

## Source of truth
- Metric registrations reside in `internal/platform/telemetry/metrics.go`.
- Logger wrapper resides in `internal/platform/logger/logger.go`.

## Invariants
- **ZERO HIGH-CARDINALITY LABELS:** Never use `room_id`, `user_id`, `event_id`, or `ip_address` as Prometheus metric labels.
- All logs must be structured JSON containing `request_id` or `connection_id` when available.
- Secrets, tokens, and passwords must be automatically redacted before outputting logs.

## Workflow
1. For logging: use `logger.InfoContext(ctx, "message", "key", value)`.
2. For metrics: select an existing metric from `internal/platform/telemetry` or define a new vector with low-cardinality labels (e.g. `status_code`, `event_family`).
3. Increment counter or observe duration using `defer prometheus.NewTimer(...).ObserveDuration()`.
4. Verify `/metrics` endpoint formats the new metric correctly.

## Implementation rules
- **WHAT TO DO:** Use histogram buckets tailored to domain latency expectations (<50ms for broadcasts).
- **WHAT NOT TO DO:** Never use `fmt.Println` or unstructured `log.Printf`.
- **WHY:** Unstructured logs cannot be indexed, filtered, or correlated in centralized logging systems (Datadog, Loki).
- **HOW TO VERIFY IT:** Scrape `GET /metrics` and inspect output format.

## Failure cases
- If metric collector fails or histogram observation encounters an unexpected label value, the application must not panic or disrupt request handling.

## Security considerations
- Audit log keys against `redactedKeys` list to prevent JWT or secret leaks.

## Testing
- Unit test that context logger extracts correlation IDs correctly.
- Test that metric increment functions correctly adjust Prometheus counter values.

## Verification
- `curl http://localhost:8080/metrics` returns valid Prometheus exposition text.
- Log output parses as valid JSON with required correlation fields.

## Common mistakes
- Adding a metric label like `room_id` to `room_broadcast_duration_seconds`, causing Prometheus memory to balloon after thousands of rooms are created.

## Completion report
Upon finishing changes, summarize:
1. Metrics or log fields added.
2. Cardinality verification confirmed (zero dynamic UUID labels).
3. Secret redaction verified.
