# Observability, Telemetry & Structured Logging — Mingly

This document specifies the structured logging format, contextual correlation dimensions, and bounded metric specifications for Mingly.

---

## 1. Structured Logging with `log/slog`

All backend logging is structured as JSON using Go's standard library `log/slog`. Plain text string formatting (`fmt.Printf`, `log.Println`) is strictly prohibited in production code.

### Mandatory Contextual Dimensions

Every log entry must carry correlation context injected through `context.Context` or handler state:

| Dimension | Key Name | Example Value | Description |
| :--- | :--- | :--- | :--- |
| **Request ID** | `request_id` | `"req_7a8b9c1d"` | Unique HTTP request correlation ID (from `chi/middleware`). |
| **Room ID** | `room_id` | `"8a4f21b8-6c3e-4d05-..."` | UUID of the room being operated upon. |
| **Participant ID** | `participant_id`| `"user:8a4f21b8-..."` | Canonical identity string (`user:<uuid>` or `guest:<uuid>`). |
| **Connection ID** | `connection_id` | `"conn_f42b891a-..."` | Unique UUID assigned to the active WebSocket socket. |
| **Instance ID** | `instance_id` | `"inst_east_78b9"` | Container or process identifier of the Go backend node. |
| **Event Type** | `event_type` | `"chat.send"` | Realtime protocol event name. |

### Redaction Invariant (Zero Credential Leaks)
> **CRITICAL SECURITY RULE:** Authorization headers, Supabase JWTs, guest tokens, LiveKit API secrets, and passwords must **NEVER** be logged under any circumstance. Payloads must be sanitized before passing to loggers.

---

## 2. Example Structured Log Entries

```json
{
  "time": "2026-09-14T10:48:12.104Z",
  "level": "INFO",
  "msg": "websocket joined",
  "instance_id": "inst_east_78b9",
  "room_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
  "connection_id": "conn_f42b891a",
  "participant_id": "user:1234-...",
  "identity_type": "user"
}
```

```json
{
  "time": "2026-09-14T10:52:01.320Z",
  "level": "WARN",
  "msg": "slow consumer disconnected",
  "instance_id": "inst_east_78b9",
  "room_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
  "connection_id": "conn_9876-...",
  "buffered_frames": 64,
  "action": "CloseNow"
}
```

---

## 3. Production Metrics Catalog (Prometheus)

All metrics are designed for low cardinality. Dynamic UUIDs (`room_id`, `user_id`, `client_ip`) are **strictly prohibited** as Prometheus labels to prevent collector memory exhaustion.

### Registered Metrics

| Metric Name | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `http_requests_total` | Counter | `method`, `path`, `status` | Total HTTP requests handled. |
| `http_request_duration_seconds` | Histogram | `method`, `path` | HTTP request latency distribution ($P_{50}, P_{95}, P_{99}$). |
| `websocket_connections_active` | Gauge | `instance_id` | Current active WebSocket connections on this node. |
| `websocket_rooms_active` | Gauge | `instance_id` | Current active in-memory rooms on this node. |
| `websocket_slow_clients_dropped_total` | Counter | `reason` | Saturated slow consumer connections terminated. |
| `realtime_broadcast_duration_seconds` | Histogram | `event_family` | Time taken to fan out events to room subscribers. |
| `redis_pubsub_messages_total` | Counter | `direction` (`pub`/`sub`) | Cross-instance messages routed via Redis. |
| `redis_operation_errors_total` | Counter | `operation` | Failures communicating with Redis. |
| `database_query_duration_seconds` | Histogram | `query_name` | PostgreSQL query latencies. |
| `livekit_token_grants_total` | Counter | `identity_type` | Successfully minted LiveKit tokens. |
| `media_drift_corrections_total` | Counter | `tier` (`soft`/`hard`) | Client-side drift correction events. |

---

## 4. Alerting Thresholds (Production Playbook)

1. **Slow Consumer Spike**: `rate(websocket_slow_clients_dropped_total[5m]) > 10`
   - *Investigation*: Inspect network congestion or frontend rendering freeze.
2. **Redis Outage**: `redis_operation_errors_total > 0`
   - *Behavior*: Backend falls back to local in-memory operation; investigate Redis cluster health.
3. **Database Connection Saturation**: `pgxpool.AcquireDuration > 500ms`
   - *Investigation*: Identify unindexed queries or connection pool exhaustion.
