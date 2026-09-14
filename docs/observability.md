# Observability, Telemetry & Logging Architecture — Loft

## 1. Observability Philosophy

Observability in Loft is designed to provide rapid diagnosis of distributed race conditions, latency spikes, and disconnect storms without bloating runtime memory or leaking sensitive information.

---

## 2. Structured Logging with `log/slog`

All backend logging is structured as JSON using Go's standard library `slog`.

### Mandatory Contextual Dimensions

Every log entry must carry correlation context injected through `context.Context`:

| Dimension | Type | Description |
| :--- | :--- | :--- |
| `request_id` | UUID | HTTP request correlation identifier. |
| `connection_id`| String | Unique per-socket identifier (`conn_<uuid>`). |
| `instance_id` | String | Identifier of the running Go backend container/process. |
| `room_id` | UUID | Target room identifier (safe for logs, NOT metrics). |
| `user_id` | UUID | Authenticated user or guest identifier. |
| `event_type` | String | Realtime protocol event name (`media.play`, `room.join`). |
| `event_id` | UUID | Client- or server-generated event UUID. |

### Example Structured Log Event
```json
{
  "time": "2026-09-14T10:48:12.104Z",
  "level": "INFO",
  "msg": "realtime event broadcast complete",
  "instance_id": "loft-backend-78b9",
  "room_id": "c73d9e84-1b72-4d26-9f4a-71829e81b674",
  "connection_id": "conn_f42b891a",
  "user_id": "8a4f21b8-6c3e-4d05-9271-93e5a2c418f2",
  "event_type": "media.play",
  "event_id": "9b12a84c-3e21-4d10-8fa4-61729b84a123",
  "duration_ms": 1.42,
  "recipients_count": 8
}
```

---

## 3. Prometheus Metrics & Cardinality Guardrails

### The High-Cardinality Cardinal Rule
> **CRITICAL RULE:** Never use dynamic UUIDs (`room_id`, `user_id`, `event_id`, `client_ip`) as Prometheus metric labels. High-cardinality labels cause unbounded memory growth in metric collectors (Prometheus/Grafana Mimir) and can crash the monitoring infrastructure. UUIDs belong in **logs and traces only**.

### Registered Prometheus Metrics Catalog

```go
package telemetry

import "github.com/prometheus/client_golang/prometheus"

var (
    // HTTP Metrics
    HTTPRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total number of HTTP requests processed.",
        },
        []string{"method", "path", "status_code"},
    )
    HTTPRequestDurationSeconds = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request latency distributions.",
            Buckets: prometheus.DefBuckets,
        },
        []string{"method", "path"},
    )

    // WebSocket & Realtime Metrics
    WebSocketConnections = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "websocket_connections_active",
            Help: "Current number of active WebSocket connections on this node.",
        },
    )
    WebSocketSlowClientsTotal = prometheus.NewCounter(
        prometheus.CounterOpts{
            Name: "websocket_slow_clients_total",
            Help: "Count of slow clients dropped due to saturated outbound buffers.",
        },
    )
    RoomBroadcastDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "room_broadcast_duration_seconds",
            Help:    "Time taken to fan out events to room subscribers.",
            Buckets: []float64{0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1},
        },
        []string{"event_family"},
    )

    // Media & Synchronization Metrics
    MediaCommandsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "media_commands_total",
            Help: "Count of media state mutations processed.",
        },
        []string{"action", "provider", "status"},
    )
    MediaSyncDriftMs = prometheus.NewHistogram(
        prometheus.HistogramOpts{
            Name:    "media_sync_drift_ms",
            Help:    "Observed client drift reported during periodic telemetry pings.",
            Buckets: []float64{50, 100, 250, 500, 1000, 2500, 5000},
        },
    )
)
```

---

## 4. Service Indicators & Pragmatic SLOs

Rather than arbitrary SLAs, we track actionable service indicators:

| Service Indicator | Measurement Point | Target Indicator |
| :--- | :--- | :--- |
| **Room Join Latency** | Time from HTTP/WS upgrade to `room.snapshot` delivery | $P_{95} < 150\text{ms}$ |
| **Media Command Latency** | Time from client `media.play` to room broadcast receipt | $P_{95} < 50\text{ms}$ |
| **WebSocket Reconnect Success** | Percentage of reconnecting clients successfully resynced | $> 99.5\%$ |
| **Slow Client Rate** | Percentage of active connections forcibly terminated | $< 0.1\%$ |
| **LiveKit Token Generation** | Go internal token generation latency | $P_{99} < 10\text{ms}$ |

---

## 5. Profiling & Diagnostics (`pprof`)

In development and staging, Go’s runtime diagnostic profiler is exposed on an internal localhost port (`:6060/debug/pprof/`):
- Memory heap profile: `go tool pprof http://localhost:6060/debug/pprof/heap`
- Goroutine dump: `go tool pprof http://localhost:6060/debug/pprof/goroutine`
- 30-second CPU trace: `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30`
