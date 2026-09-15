package telemetry

import (
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

// DurationHistogram has fixed buckets and no dynamic labels, so observations
// cannot grow Prometheus series cardinality with rooms or users.
type DurationHistogram struct {
	buckets [9]atomic.Uint64
	count   atomic.Uint64
	sumNs   atomic.Uint64
}

var durationBounds = [...]time.Duration{
	1 * time.Millisecond,
	2 * time.Millisecond,
	5 * time.Millisecond,
	10 * time.Millisecond,
	25 * time.Millisecond,
	50 * time.Millisecond,
	100 * time.Millisecond,
	250 * time.Millisecond,
	1 * time.Second,
}

func (h *DurationHistogram) Observe(d time.Duration) {
	if d < 0 {
		d = 0
	}
	// Increment the total before its bucket so a concurrent scrape can never
	// report a +Inf count smaller than a finite bucket.
	h.count.Add(1)
	for i, bound := range durationBounds {
		if d <= bound {
			h.buckets[i].Add(1)
			break
		}
	}
	h.sumNs.Add(uint64(d))
}

func (h *DurationHistogram) Prometheus(name, help string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s histogram\n", name, help, name)
	var cumulative uint64
	for i, bound := range durationBounds {
		cumulative += h.buckets[i].Load()
		fmt.Fprintf(&b, "%s_bucket{le=\"%g\"} %d\n", name, bound.Seconds(), cumulative)
	}
	fmt.Fprintf(&b, "%s_bucket{le=\"+Inf\"} %d\n", name, h.count.Load())
	fmt.Fprintf(&b, "%s_sum %g\n%s_count %d\n", name, float64(h.sumNs.Load())/float64(time.Second), name, h.count.Load())
	return b.String()
}
