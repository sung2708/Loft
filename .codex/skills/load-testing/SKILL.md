# Skill: Load Testing & Performance Benchmarking

## WHEN TO USE THIS SKILL
Use this skill whenever benchmarking system concurrency, stress testing WebSocket broadcast throughput, profiling memory/goroutine stability with pprof, or verifying slow consumer isolation under load.

## SOURCE OF TRUTH
- **Profiles & Benchmarks**: [load-testing.md](file:///d:/git/Loft/docs/load-testing.md).
- **Concurrency Guidelines**: [concurrency.md](file:///d:/git/Loft/docs/concurrency.md).

## ARCHITECTURAL BOUNDARIES
- Scaled for realistic MVP 2 social hangout room sizes (10, 25, 50, 100 concurrent connections).
- No synthetic enterprise scale tests against live external APIs (LiveKit cloud, YouTube embed APIs).
- Metrics evaluated strictly against local/staging test containers.

## REQUIRED WORKFLOW
1. **Select Load Scenario**:
   - Choose from: Join burst, leave burst, chat burst (70 msgs/s), media control race, slow consumer injection, or reconnect storm.
2. **Execute Benchmark**:
   - Run k6 script or Go benchmark harness (`go test -bench=. ./internal/realtime/...`).
   - Ramp up virtual users in stages (e.g. 10 → 25 → 50 → 100).
3. **Capture Runtime Metrics**:
   - Inspect broadcast fan-out latency ($P_{95}$).
   - Capture memory heap profile via `go tool pprof http://localhost:8080/debug/pprof/heap`.
   - Capture goroutine stack profile via `go tool pprof http://localhost:8080/debug/pprof/goroutine`.
4. **Evaluate Pass/Fail Criteria**:
   - Assert $P_{95}$ broadcast latency $< 5\text{ms}$.
   - Assert goroutines stabilize at $\sim 2$ per connection.
   - Assert saturated slow consumers are dropped in $< 50\text{ms}$.

## IMPLEMENTATION RULES
- Always document hardware specs, Go runtime version, and operating system alongside benchmark numbers.
- Ensure all benchmark harnesses run with `-race` enabled on concurrency tests.

## FAILURE CASES
- **Goroutine Leak**: Goroutine count increases linearly without plateauing; inspect blocking channels in pprof.
- **Broadcast Lag Spike**: $P_{95}$ latency spikes $>25\text{ms}$; indicates lock contention or synchronous I/O inside mutex.

## TEST REQUIREMENTS
- Profile A (10 conns): 100% pass on local laptop.
- Profile C (50 conns): 100% pass on staging cluster without data races.

## DO NOT
- DO NOT invent unrealistic 100,000-connection enterprise benchmarks for an MVP 2 hangout app.
- DO NOT benchmark without monitoring memory and goroutines.
- DO NOT stress live YouTube or Supabase production endpoints during synthetic tests.

## DONE WHEN
- Target concurrency profile runs for sustained 2 minutes without panics or memory leaks.
- $P_{95}$ broadcast latency is within $<5\text{ms}$.
- Slow consumers are reaped cleanly without delaying fast peers.
