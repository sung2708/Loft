# Load Testing & Performance Benchmarking — Loft

## 1. Load Testing Philosophy

Realtime systems fail in ways that traditional request-response REST APIs never do:
- Saturated client TCP buffers causing head-of-line blocking.
- Broadcast fan-out explosions ($O(N^2)$ message amplification).
- Concurrency contention on synchronized room state locks.
- Reconnect storms exhausting file descriptors and CPU handshakes.

A system is not validated merely by running a synthetic HTTP benchmark; it must be stressed with realistic concurrent user patterns.

---

## 2. Progressive Load Profiles

All benchmarks must document the exact hardware, Go runtime version, and network topology:

| Profile | Concurrent WS | Rooms | Typical Room Topology | Target Environment |
| :--- | :--- | :--- | :--- | :--- |
| **Profile A (Dev)** | 50 | 5 | 10 users / room | Local laptop (1 node, local Redis/DB) |
| **Profile B (Staging)** | 200 | 20 | 10 users / room | Staging cluster (2 Go nodes, Redis, Postgres) |
| **Profile C (Target)** | 500 | 25 | 20 users / room | Production baseline |
| **Profile D (Stress)** | 1,000+ | 10 | 100 users / room (Large Stage) | Breakpoint stress test (Slow-consumer analysis) |

---

## 3. Concrete Load Test Scenarios

### Scenario 1: Reconnect Storm (Node Recovery)
- **Pattern:** 500 active WebSocket connections receive a sudden disconnect (simulating node crash), then attempt reconnecting over a 3-second window.
- **Verification Criteria:**
  - Jitter prevents HTTP upgrade starvation.
  - Zero goroutine leaks.
  - 100% of clients successfully recover state via `room.snapshot`.
  - Max connection establishment latency $P_{95} < 1000\text{ms}$.

### Scenario 2: High-Frequency Reaction & Chat Burst (Fan-Out Stress)
- **Pattern:** In a 50-participant room, 20 users generate 5 reactions/second and 2 chat messages/second simultaneously for 60 seconds.
- **Fan-Out Math:**
  $$\text{Broadcast Rate} = 20 \times (5 + 2) \times 50 = 7,000 \text{ msgs/sec}$$
- **Verification Criteria:**
  - Non-blocking broadcast buffers absorb bursts without increasing room lock latency ($< 1\text{ms}$).
  - Ephemeral reactions are safely dropped if client buffers saturate; critical chat messages and room state are preserved.

### Scenario 3: Media Control Contention (Play/Pause Race)
- **Pattern:** 10 clients concurrently issue `media.play`, `media.pause`, and `media.seek` commands with varying `expected_version` values.
- **Verification Criteria:**
  - In-memory `RoomActor` processes mutations strictly sequentially.
  - Exactly one command increments the version; stale commands are cleanly rejected with `409 / ERROR_STALE_VERSION`.
  - Zero split-brain states; all clients converge to identical playback offset.

### Scenario 4: Slow Consumer Injection
- **Pattern:** In a 50-user room, 5 simulated clients stop reading from their TCP sockets (simulating suspended mobile browsers).
- **Verification Criteria:**
  - The remaining 45 fast clients experience **zero** latency degradation.
  - Saturated slow clients are dropped after the 5-second buffer timeout.
  - Reaping slow connections frees associated memory and goroutines.

---

## 4. Benchmark Scripting with k6 & Go Test Harness

A dedicated Go load testing harness (`loadtest/main.go`) or `k6` script (`loadtest/ws_room_test.js`) simulates multi-user room scenarios:

```javascript
// Example k6 WebSocket test scenario excerpt
import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 200 }, // Ramp-up
    { duration: '2m', target: 200 },  // Sustained load
    { duration: '30s', target: 0 },   // Ramp-down
  ],
};

export default function () {
  const url = 'ws://localhost:8080/ws';
  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      // 1. Authenticate
      socket.send(JSON.stringify({ type: 'connection.auth', payload: { token: 'guest_...' } }));
    });
    socket.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'connection.authenticated') {
        // 2. Join room
        socket.send(JSON.stringify({ type: 'room.join', payload: { room_id: 'test_room' } }));
      }
    });
  });
  check(res, { 'status is 101': (r) => r && r.status === 101 });
}
```

---

## 5. Metrics to Record During Runs

After executing a load test profile, record and commit the run sheet:
- **Hardware:** CPU cores, RAM, OS, Docker specs.
- **Throughput:** Inbound msgs/sec, Outbound msgs/sec.
- **Latency Percentiles:** $P_{50}, P_{90}, P_{95}, P_{99}$ for room joins and media commands.
- **Runtime Health:** Peak heap allocations (`alloc_bytes`), Goroutine count, GC pause duration (`gc_pause_ns`).
- **Failures:** Disconnect count, HTTP error rate, slow client drops.
