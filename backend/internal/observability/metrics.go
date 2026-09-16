package observability

import "github.com/prometheus/client_golang/prometheus"

// Metrics owns a process-local registry so tests and multiple server instances
// never collide through Prometheus' global registry.
type Metrics struct {
	Registry     *prometheus.Registry
	HTTPRequests *prometheus.CounterVec
	HTTPDuration *prometheus.HistogramVec
}

func NewMetrics() *Metrics {
	registry := prometheus.NewRegistry()
	requests := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total HTTP requests served.",
	}, []string{"method", "path", "status"})
	duration := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})
	registry.MustRegister(requests, duration)
	return &Metrics{Registry: registry, HTTPRequests: requests, HTTPDuration: duration}
}
