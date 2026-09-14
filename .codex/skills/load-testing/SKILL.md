# Skill: Load Testing & Performance Benchmarking

## Trigger
Use this skill whenever benchmarking system capacity, stress testing WebSocket concurrency, testing reconnect storms, or evaluating slow-consumer behavior under load.

## Goals
- Execute realistic multi-client benchmark profiles (A through D).
- Measure latency percentiles ($P_{50}, P_{95}, P_{99}$), throughput, and memory stability.
- Validate that slow consumers do not degrade room broadcast performance.

## Required reading
- [load-testing.md](file:///d:/git/Loft/docs/load-testing.md)
- [concurrency.md](file:///d:/git/Loft/docs/concurrency.md)
- [observability.md](file:///d:/git/Loft/docs/observability.md)

## Source of truth
- Benchmark scenarios and target profiles defined in [load-testing.md](file:///d:/git/Loft/docs/load-testing.md).

## Invariants
- Never claim capacity without recording hardware specs, Go version, and latency percentiles.
- Load tests must monitor runtime goroutines (`runtime.NumGoroutine()`) to catch concurrency leaks.
- A test is failed if $P_{95}$ broadcast latency exceeds $50\text{ms}$ under Profile C (500 connections).

## Workflow
1. Select target profile (Profile A: 50 conns, Profile B: 200 conns, Profile C: 500 conns).
2. Start the local or staging stack with monitoring enabled (`/metrics`, `/debug/pprof`).
3. Launch load test harness using `k6` or Go load client (`loadtest/main.go`).
4. Execute reconnect storm, chat burst, or slow-consumer scenario.
5. Record metrics: Inbound/Outbound msg rate, CPU%, Heap MB, Goroutine peak.
6. Check for race conditions or memory leaks via pprof heap profile.

## Implementation rules
- **WHAT TO DO:** Ramp up virtual users progressively with warm-up periods.
- **WHAT NOT TO DO:** Never run infinite-load stress tests against third-party production APIs (e.g. live YouTube or LiveKit cloud).
- **WHY:** Violates provider terms of service and triggers external IP bans.
- **HOW TO VERIFY IT:** Review load test run sheets and latency distributions.

## Failure cases
- If goroutine count increases linearly without plateauing under steady load, a goroutine leak exists; inspect with `go tool pprof /debug/pprof/goroutine`.

## Security considerations
- Isolate load testing traffic to dedicated test environments or local Docker networks.

## Testing
- Run Profile A locally before merging major changes to the realtime hub or room actor.

## Verification
- Target load sustained for 5 minutes with zero unhandled panics and <0.1% connection drop rate.

## Common mistakes
- Measuring only HTTP request latency and ignoring WebSocket broadcast fan-out delays.

## Completion report
Upon finishing changes, summarize:
1. Load profile tested and virtual user count.
2. Latency percentiles ($P_{50}, P_{95}, P_{99}$).
3. Peak memory, CPU, and goroutine count.
4. Bottlenecks or optimizations identified.
