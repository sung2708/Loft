package ratelimit

import (
	"context"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type entry struct {
	limiter *rate.Limiter
	seen    time.Time
}
type Limiter struct {
	mu       sync.Mutex
	entries  map[string]*entry
	rate     rate.Limit
	burst    int
	events   int
	per      time.Duration
	remoteMu sync.RWMutex
	remote   Distributed
	category string
}

// Distributed implements the same token-bucket policy atomically across nodes.
// A Redis outage is reported as an error so the limiter can fall back locally.
type Distributed interface {
	AllowRate(context.Context, string, string, int, time.Duration, int) (bool, error)
}

func New(events int, per time.Duration, burst int) *Limiter {
	return &Limiter{entries: make(map[string]*entry), rate: rate.Limit(float64(events) / per.Seconds()), burst: burst, events: events, per: per}
}

// SetDistributed must be configured before serving requests. It remains safe
// to switch during runtime, for example when a Redis bus is replaced.
func (l *Limiter) SetDistributed(category string, remote Distributed) {
	l.remoteMu.Lock()
	l.category, l.remote = category, remote
	l.remoteMu.Unlock()
}

func (l *Limiter) Allow(key string) bool { return l.AllowContext(context.Background(), key) }

func (l *Limiter) AllowContext(parent context.Context, key string) bool {
	l.remoteMu.RLock()
	remote, category := l.remote, l.category
	l.remoteMu.RUnlock()
	if remote != nil {
		ctx, cancel := context.WithTimeout(parent, 350*time.Millisecond)
		allowed, err := remote.AllowRate(ctx, category, key, l.events, l.per, l.burst)
		cancel()
		if err == nil {
			return allowed
		}
	}
	return l.allowLocal(key)
}

func (l *Limiter) allowLocal(key string) bool {
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
