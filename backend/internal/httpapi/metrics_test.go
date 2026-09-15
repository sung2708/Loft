package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type metricsWS struct{}

func (metricsWS) ServeHTTP(http.ResponseWriter, *http.Request) {}
func (metricsWS) PrometheusMetrics() string                    { return "loft_realtime_connections_accepted_total 0\n" }

func TestMetricsIncludeHTTPAndRealtime(t *testing.T) {
	server := &Server{origins: map[string]struct{}{}}
	routes := server.Routes(metricsWS{})
	for i := 0; i < 2; i++ {
		response := httptest.NewRecorder()
		routes.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("health request %d returned %d", i, response.Code)
		}
	}
	response := httptest.NewRecorder()
	routes.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("metrics returned %d", response.Code)
	}
	for _, want := range []string{
		"loft_http_requests_total 2",
		"loft_http_request_duration_seconds_count 2",
		"loft_realtime_connections_accepted_total 0",
	} {
		if !strings.Contains(response.Body.String(), want) {
			t.Fatalf("metrics response missing %q: %s", want, response.Body.String())
		}
	}
}
