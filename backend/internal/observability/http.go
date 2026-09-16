package observability

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
)

// HTTPMiddleware logs one sanitized, structured event and emits two bounded
// Prometheus series per request. It uses chi route patterns, never raw URL
// paths, so UUIDs and user input cannot create high-cardinality labels.
func HTTPMiddleware(base zerolog.Logger, metrics *Metrics) func(http.Handler) http.Handler {
	if metrics == nil {
		metrics = NewMetrics()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			requestID := chimiddleware.GetReqID(r.Context())
			requestLogger := base.With().
				Str("request_id", requestID).
				Str("method", r.Method).
				Str("client_ip", clientIP(r)).
				Logger()
			ctx := requestLogger.WithContext(r.Context())
			recorder := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(recorder, r.WithContext(ctx))

			route := routePattern(r)
			status := fmt.Sprintf("%d", recorder.status)
			elapsed := time.Since(started)
			metrics.HTTPRequests.WithLabelValues(r.Method, route, status).Inc()
			metrics.HTTPDuration.WithLabelValues(r.Method, route).Observe(elapsed.Seconds())
			requestLogger.Info().
				Str("route", route).
				Int("status", recorder.status).
				Dur("latency", elapsed).
				Msg("http request completed")
		})
	}
}

func routePattern(r *http.Request) string {
	if routeContext := chi.RouteContext(r.Context()); routeContext != nil {
		if pattern := routeContext.RoutePattern(); pattern != "" {
			return pattern
		}
	}
	return "/unmatched"
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Real-IP")); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

// ContextLogger exposes request-scoped logging to handlers that need to add
// domain fields without duplicating request ID, method, or client IP.
func ContextLogger(ctx context.Context) *zerolog.Logger { return zerolog.Ctx(ctx) }
