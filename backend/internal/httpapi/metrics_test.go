package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
	if response.Code != http.StatusNotFound {
		t.Fatalf("unconfigured metrics endpoint returned %d, want 404", response.Code)
	}
	server.ConfigureMetricsBearerToken("01234567890123456789012345678901")
	routes = server.Routes(metricsWS{})
	unauthorized := httptest.NewRecorder()
	routes.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized metrics returned %d, want 401", unauthorized.Code)
	}
	wrongToken := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	wrongToken.Header.Set("Authorization", "Bearer wrong-token")
	wrongTokenResponse := httptest.NewRecorder()
	routes.ServeHTTP(wrongTokenResponse, wrongToken)
	if wrongTokenResponse.Code != http.StatusUnauthorized {
		t.Fatalf("invalid bearer token returned %d, want 401", wrongTokenResponse.Code)
	}
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("Authorization", "Bearer 01234567890123456789012345678901")
	response = httptest.NewRecorder()
	routes.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("metrics returned %d", response.Code)
	}
	for _, want := range []string{
		`http_requests_total{method="GET",path="/health",status="200"} 2`,
		`http_request_duration_seconds_count{method="GET",path="/health"} 2`,
		`loft_realtime_connections_accepted_total 0`,
	} {
		if !strings.Contains(response.Body.String(), want) {
			t.Fatalf("metrics response missing %q: %s", want, response.Body.String())
		}
	}
}

func TestMetricsCollapseUnknownMethods(t *testing.T) {
	server := &Server{origins: map[string]struct{}{}}
	server.ConfigureMetricsBearerToken("01234567890123456789012345678901")
	routes := server.Routes(metricsWS{})
	for _, method := range []string{"CUSTOM-A", "CUSTOM-B"} {
		routes.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, "/health", nil))
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("Authorization", "Bearer 01234567890123456789012345678901")
	routes.ServeHTTP(response, request)
	got := response.Body.String()
	if !strings.Contains(got, `http_requests_total{method="OTHER",path="/unmatched",status="405"} 2`) || strings.Contains(got, `method="CUSTOM-`) {
		t.Fatalf("unknown methods created separate metrics: %s", got)
	}
}

type metricsWS struct{}

func (metricsWS) ServeHTTP(http.ResponseWriter, *http.Request) {}

func (metricsWS) PrometheusMetrics() string {
	return "loft_realtime_connections_accepted_total 0\n"
}
