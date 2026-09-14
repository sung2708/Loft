package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type entry struct {
	limiter *rate.Limiter
	seen    time.Time
}
type Limiter struct {
	mu      sync.Mutex
	entries map[string]*entry
	rate    rate.Limit
	burst   int
}

func New(events int, per time.Duration, burst int) *Limiter {
	return &Limiter{entries: make(map[string]*entry), rate: rate.Limit(float64(events) / per.Seconds()), burst: burst}
}

func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	item := l.entries[key]
	if item == nil {
		if len(l.entries) >= 4096 {
			oldestKey := ""
			oldestSeen := now
			for candidateKey, candidate := range l.entries {
				if oldestKey == "" || candidate.seen.Before(oldestSeen) {
					oldestKey, oldestSeen = candidateKey, candidate.seen
				}
			}
			if oldestKey != "" {
				delete(l.entries, oldestKey)
			}
		}
		item = &entry{limiter: rate.NewLimiter(l.rate, l.burst)}
		l.entries[key] = item
	}
	item.seen = now
	return item.limiter.Allow()
}
