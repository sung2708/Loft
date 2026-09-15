package telemetry

import (
	"strings"
	"testing"
	"time"
)

func TestDurationHistogramPrometheus(t *testing.T) {
	var h DurationHistogram
	h.Observe(500 * time.Microsecond)
	h.Observe(3 * time.Millisecond)
	h.Observe(2 * time.Second)
	output := h.Prometheus("loft_test_duration_seconds", "Test latency")
	for _, want := range []string{
		`loft_test_duration_seconds_bucket{le="0.001"} 1`,
		`loft_test_duration_seconds_bucket{le="0.005"} 2`,
		`loft_test_duration_seconds_bucket{le="+Inf"} 3`,
		"loft_test_duration_seconds_count 3",
		"loft_test_duration_seconds_sum 2.0035",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("missing %q in:\n%s", want, output)
		}
	}
}
