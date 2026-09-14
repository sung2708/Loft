# Load Testing & Performance Benchmarking — Loft

This document specifies realistic multi-user load testing profiles, benchmark scenarios, target metric thresholds, and profiling procedures for **Loft MVP 2**.

---

## 1. Realistic MVP 2 Scale Profiles

Loft is engineered for high-concurrency social rooms without premature enterprise complexity. Load profiles are scaled to validate the product's actual operational limits:

| Profile | Concurrent WS | Active Rooms | Typical Room Topology | Target Environment |
| :--- | :---: | :---: | :--- | :--- |
| **Profile A (Dev)** | **10** | 1 | 10 users / room | Local development machine (Single Go node) |
| **Profile B (Standard)**| **25** | 2 | 12 users / room | Staging server (1 Go node + Redis) |
| **Profile C (Target)** | **50** | 5 | 10 users / room | Production baseline (2 Go nodes + Redis) |
| **Profile D (Stress)** | **100** | 2 | 50 users / room (Large Stage) | Breakpoint stress & slow consumer analysis |

---

## 2. Benchmark Scenarios

### Scenario 1: Join & Leave Bursts
- **Pattern**: 25 clients connect simultaneously within 500ms, perform handshake authentication, receive `room.snapshot`, and 10 clients disconnect after 5 seconds.
- **Verification Criteria**:
  - Zero authentication timeouts.
  - Snapshot delivery latency $P_{95} < 50\text{ms}$.
  - Connection teardown cleanly frees memory and reaps goroutines.

### Scenario 2: Chat Fan-Out & Reaction Burst
- **Pattern**: In a 50-participant room, 10 simulated users each send 2 chat messages/sec and 5 reactions/sec continuously for 60 seconds.
- **Broadcast Math**:
  $$\text{Total Events/sec} = 10 \times (2 + 5) = 70 \text{ in/sec} \implies \text{Fan-Out} = 70 \times 50 = 3,500 \text{ frames/sec}$$
- **Verification Criteria**:
  - Broadcast loop execution latency $P_{95} < 2\text{ms}$.
  - Zero lock contention on room state mutex.
  - Ephemeral reactions drop gracefully if any buffer fills; critical chat messages are 100% delivered.

### Scenario 3: Media Control Contention (Race Guard)
- **Pattern**: 10 users concurrently issue `media.play`, `media.pause`, and `media.seek` commands with varying `expected_version` values.
- **Verification Criteria**:
  - Server serializes mutations deterministically.
  - Stale commands are rejected with `409 / MEDIA_COMMAND_REJECTED`.
  - Exactly one version increment per valid command; all 50 clients converge to identical playback state.

### Scenario 4: Slow Consumer Injection
- **Pattern**: In a 50-client room, 5 mock clients stop reading from their TCP sockets (simulating backgrounded mobile devices).
- **Verification Criteria**:
  - Saturated clients fill their 64-frame buffer and are disconnected immediately (`CloseNow`).
  - The remaining 45 healthy clients experience **zero** latency spike or packet loss.

### Scenario 5: Reconnect Storm (Node Recovery)
- **Pattern**: 50 active connections drop abruptly and attempt reconnecting over a 3-second window.
- **Verification Criteria**:
  - Exponential jitter distributes connection attempts.
  - 100% of reconnecting clients recover room state via snapshot within 1.5 seconds.
  - Zero duplicate session conflicts.

### Scenario 6: Cross-Instance Redis Pub/Sub Fan-Out
- **Pattern**: 2 Go instances connected to Redis; Room X has 25 clients on Instance 1 and 25 clients on Instance 2.
- **Verification Criteria**:
  - Messages published on Instance 1 reach clients on Instance 2 with inter-node latency $<10\text{ms}$.
  - Zero duplicate echo loops (verified by checking `origin_instance_id`).

---

## 3. Measured System Metrics & Pass/Fail Thresholds

| Metric | Measurement Tool | Pass Threshold | Fail Threshold |
| :--- | :--- | :---: | :---: |
| **Broadcast Fan-Out Latency** | Prometheus `realtime_broadcast_duration_seconds` | $P_{95} < 5\text{ms}$ | $P_{95} > 25\text{ms}$ |
| **WebSocket Snapshot Delivery**| Client Roundtrip Benchmark | $P_{95} < 50\text{ms}$ | $P_{95} > 200\text{ms}$ |
| **Backend Memory Consumption** | Go `pprof` heap profile | $< 150\text{MB}$ for 100 conns | $> 350\text{MB}$ (Leak) |
| **Goroutine Count Stability** | Go `pprof` goroutines | Bounded ($\sim 2$ per conn) | Unbounded growth |
| **Slow Consumer Reaping** | Server log event timestamps | Disconnect in $<50\text{ms}$ | Blocking broadcast loop |
| **Data Race Violations** | `go test -race ./...` | **0 races** | $> 0$ races |

---

## 4. Benchmark Execution Command Reference

```powershell
# 1. Run race-detector unit benchmarks
go test -race -bench=. ./internal/realtime/...

# 2. Inspect memory and goroutines with pprof
go tool pprof http://localhost:8080/debug/pprof/heap
go tool pprof http://localhost:8080/debug/pprof/goroutine

# 3. Execute k6 WebSocket load test
k6 run --vus 50 --duration 2m loadtest/k6_room_burst.js
```
