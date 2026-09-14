# Reconnect & Snapshot Recovery Architecture — Loft

## 1. Resilience Philosophy: Networks Fail Regularly

In realtime mobile and web apps, network transitions (switching between 5G and WiFi, driving through a tunnel, laptop wake-from-sleep) are **standard operating conditions**, not exceptional anomalies.

### Core Architectural Invariants
1. **Snapshot Recovery Over Event Replay:** We do **not** maintain unbounded distributed replay logs. If a client drops packets during a disconnect, it recovers by receiving a fresh, authoritative `room.snapshot`.
2. **Deterministic State Machine:** The client connection state must be modeled as a strict finite state machine (FSM) rather than an error-prone combination of disconnected booleans (`isReconnecting && isConnected`).
3. **Thundering Herd Protection:** All client reconnection attempts must employ exponential backoff with randomized jitter to prevent server saturation during node restarts.

---

## 2. Formal Connection State Machine

```
                  ┌──────────────────────────────┐
                  │         DISCONNECTED         │
                  └──────────────┬───────────────┘
                                 │ connect()
                                 ▼
                  ┌──────────────────────────────┐
                  │          CONNECTING          │
                  └──────────────┬───────────────┘
                                 │ TCP / WS Upgraded
                                 ▼
                  ┌──────────────────────────────┐
                  │        AUTHENTICATING        │
                  └──────────────┬───────────────┘
                                 │ auth.success
                                 ▼
                  ┌──────────────────────────────┐
                  │          CONNECTED           │◄─────────────────────────┐
                  └──────────────┬───────────────┘                          │
                                 │ Network Drop / Socket EOF                │
                                 ▼                                          │
                  ┌──────────────────────────────┐                          │
                  │         RECONNECTING         │ (Backoff + Jitter)       │
                  └──────────────┬───────────────┘                          │
                                 │ TCP Re-established & Authenticated       │
                                 ▼                                          │
                  ┌──────────────────────────────┐                          │
                  │          RESYNCING           │ (Fetch room.snapshot)    │
                  └──────────────┬───────────────┘                          │
                                 │                                          │
                  ┌──────────────┴──────────────┐                           │
                  │ Snapshot received & applied ├───────────────────────────┘
                  │ Version verified            │
                  └─────────────────────────────┘
                                 │ Max retries exceeded
                                 ▼
                  ┌──────────────────────────────┐
                  │            FAILED            │
                  └──────────────────────────────┘
```

---

## 3. Step-by-Step Reconnect Handshake

When a client detects connection loss:

1. **Phase 1: Transport Reconnect:**
   - Client enters `RECONNECTING` state.
   - Calculates backoff delay:
     $$\text{Delay} = \min\left(10000, 500 \times 1.5^{\text{attempt}}\right) \times (1 \pm \text{jitter}_{0.2})$$
   - Initiates fresh WebSocket handshake to `/ws`.

2. **Phase 2: Authentication Handshake:**
   - Sends `connection.auth` with current Supabase JWT (or cached guest token).
   - If token expired, refreshes token via Supabase client before transmission.

3. **Phase 3: Room Resubscription:**
   - Sends `room.join` with target `room_id` and the client's last known `version`.

4. **Phase 4: Snapshot Delivery & Reconciliation:**
   - Go backend validates membership, generates fresh LiveKit grant token, and responds with full `room.snapshot`.
   - Client updates `useRoomStore` with snapshot payload and sets `local_version = snapshot.version`.

5. **Phase 5: Media Resync:**
   - Client calculates server clock offset via ping/pong.
   - Calculates canonical media position and performs a Tier 3 hard seek on the active player.

6. **Phase 6: LiveKit Session Restoration:**
   - Client checks LiveKit room state. If disconnected, reconnects using fresh LiveKit token received in snapshot.

---

## 4. Why Snapshot Recovery Beats Event Sourcing / Replay Buffers

| Metric | Snapshot Recovery (Loft) | Event Replay Buffers |
| :--- | :--- | :--- |
| **Server Memory Overhead** | **$O(1)$ per room:** Only the current canonical state is retained in RAM. | **$O(N)$ per room:** Requires keeping thousands of historical events in memory. |
| **Edge Failure Handling** | Simple: Replace local state with server state. | Complex: Handling missing segments, ring buffer overflows, sequence gaps. |
| **Recovery Latency** | Single roundtrip (`room.snapshot` payload $< 10$ KB). | Multiple roundtrips requesting batches of missed events. |
| **Code Simplicity** | Clean, understandable, and testable by a single developer. | Prone to split-brain, out-of-order bugs, and memory leaks. |

---

## 5. Reconnect Storm Defense

When a Go backend node restarts or deploys:
1. Upstream proxy (e.g. Caddy / Cloudflare / Envoy) distributes incoming connections across remaining nodes.
2. Jitter ensures that 1,000 clients do not reconnect within the same 100ms window.
3. The Go connection upgrade handler checks an active rate limiter (e.g., maximum 100 handshakes/sec per IP/subnet).
