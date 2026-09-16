# Observability, Telemetry & Structured Logging — Mingly

This document specifies the structured logging format, contextual correlation dimensions, and bounded metric specifications for Mingly.

---

## 1. Structured Logging with Zerolog

The process logger is configured by `APP_ENV` in `backend/internal/observability`:

- `development`: Zerolog `ConsoleWriter` writes coloured, readable logs locally.
- every other value (including `production`): Zerolog emits JSON to stdout with RFC3339 timestamps and `caller` (`file:line`).

Existing packages use a small `slog` adapter backed by the same Zerolog instance while their constructors are migrated. There is still one structured output stream. Plain text string formatting (`fmt.Printf`, `log.Println`) is prohibited in production code.

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

### Metrics exported today

| Metric Name | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `http_requests_total` | Counter | `method`, `path`, `status` | Total HTTP requests handled. |
| `http_request_duration_seconds` | Histogram | `method`, `path` | HTTP request latency distribution ($P_{50}, P_{95}, P_{99}$). |
| `loft_realtime_connections_accepted_total` | Counter | none | Realtime connections accepted by this process. |
| `loft_realtime_broadcasts_total` | Counter | none | Local realtime broadcasts. |
| `loft_realtime_slow_consumers_total` | Counter | none | Slow consumers terminated to protect room broadcasts. |
| `loft_realtime_broadcast_duration_seconds` | Histogram | none | Local room broadcast fan-out latency. |

The HTTP middleware uses chi route templates such as `/api/v1/rooms/{roomID}`, never raw URL paths. This keeps UUIDs, invite codes, and user input out of Prometheus labels.

`/metrics` is served by `promhttp.HandlerFor` with a process-local Prometheus registry. The existing realtime exposition is appended for backward compatibility.

### Planned metrics (not exported yet)

`redis_*`, database query, LiveKit grant, active room, and media-drift metrics require a dedicated instrumentation task. Do not create alerts for them until they are exported.

## 4. Better Stack

### Logs

Create a **Go/Docker log source** in Better Stack and retain its source token and ingesting host. Production logs are JSON on stdout, so do not add a second in-process HTTP log shipper.

- **Docker or VM:** run the Better Stack Collector/Vector beside the service and configure it to read container stdout. Better Stack provides a source-specific Vector configuration at `https://telemetry.betterstack.com/vector-yaml/docker/$SOURCE_TOKEN`.
- **Render:** keep JSON on stdout, then configure a Render log drain or Better Stack Collector to forward that stream to the log source. Stdout alone is not an external log archive; the platform drain/collector is the forwarding step.

Never place a Better Stack source token in app logs, client-side variables, or Git. Store it in Render/Docker/Kubernetes secrets only.

### Metrics

Create a separate **Prometheus source** in Better Stack. Copy `deploy/prometheus/.env.example` to `deploy/prometheus/.env`, set `MINGLY_METRICS_TARGET`, `MINGLY_METRICS_SCHEME`, `APP_ENV`, `BETTER_STACK_INGESTING_HOST`, and `BETTER_STACK_METRICS_SOURCE_TOKEN`, then run Prometheus with `deploy/prometheus/prometheus.yml`. For the public Render URL `https://loft-ytxd.onrender.com`, use `MINGLY_METRICS_TARGET=loft-ytxd.onrender.com` and `MINGLY_METRICS_SCHEME=https`—do not append `:8080`. The file scrapes `/metrics` and forwards samples with Remote Write bearer authentication. Prometheus only expands `${VARIABLE}`; provide every variable explicitly through your deployment secret store.

For a managed collector instead of a local Prometheus agent, Better Stack can scrape the protected `/metrics` URL directly. Allow only the collector/scraper and require bearer authentication at the proxy if the endpoint is publicly reachable.

### Render deployment

Create a new Render **Blueprint** and set its Blueprint File Path to `deploy/prometheus/render.yaml`. This creates the private `mingly-prometheus` service with a 1 GB persistent disk for the Prometheus write-ahead log. Set the three prompted secrets in Render:

```env
MINGLY_METRICS_TARGET=loft-ytxd.onrender.com
BETTER_STACK_INGESTING_HOST=<host displayed by the Better Stack Prometheus source>
BETTER_STACK_METRICS_SOURCE_TOKEN=<source token displayed by Better Stack>
```

Keep `MINGLY_METRICS_SCHEME=https`. After the deploy is healthy, open the Better Stack source and wait for incoming samples; Prometheus scrapes every 15 seconds. `https://loft-ytxd.onrender.com/metrics` should return Prometheus text before deploying the collector.

---

## 5. Alerting Thresholds (Production Playbook)

1. **Slow Consumer Spike**: `rate(loft_realtime_slow_consumers_total[5m]) > 10`
   - *Investigation*: Inspect network congestion or frontend rendering freeze.
