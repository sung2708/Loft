# Reconnect & Snapshot Recovery Architecture — Mingly

This document specifies the client connection lifecycle, exponential backoff strategy, and authoritative snapshot state recovery for Mingly.

---

## 1. The Core Principle: Authoritative Snapshot Recovery

**Cardinal Rule**: Following any network interruption, the client **never** attempts to replay historical event streams or reconcile missed delta events. Instead, the client fetches and applies a **fresh, authoritative room snapshot** (`room.snapshot`).

### Why Snapshot Recovery Wins
- **Bounded Memory**: The backend does not maintain sliding event buffers for disconnected clients ($O(1)$ memory per room).
- **Zero Drift / Race-Free**: Replay buffers suffer from dropped packets, out-of-order execution, and state splits. Overwriting client state with an authoritative snapshot guarantees instant, 100% convergence.
- **Fast Resync**: Applying a single snapshot replaces room details, participant lists, message history, and media timelines in $<50\text{ms}$.

---

## 2. Client Connection Finite State Machine (FSM)

```
                       [ User Navigates to Room ]
                                   │
                                   ▼
                            ┌──────────────┐
                            │  CONNECTING  │
                            └──────┬───────┘
                                   │ Socket open + Auth OK + Snapshot applied
                                   ▼
                            ┌──────────────┐
                ┌──────────►│  CONNECTED   ├──────────┐
                │           └──────┬───────┘          │
   Snapshot OK  │                  │ Network drop     │ User clicks leave
   Resync clean │                  ▼ (Socket close)   ▼
        ┌───────┴──────┐    ┌──────────────┐   ┌──────────────┐
        │  RESYNCING   │    │ RECONNECTING │   │ DISCONNECTED │
        └───────▲──────┘    └──────┬───────┘   └──────────────┘
                │ Socket open      │ Max retries exceeded (8)
                └──────────────────┴──────────┐
                                              ▼
                                       ┌──────────────┐
                                       │    FAILED    │
                                       └──────────────┘
```

### State Definitions

1. **`CONNECTING`**: Initial WebSocket handshake; sending `connection.auth`.
2. **`CONNECTED`**: Authoritative `room.snapshot` received and applied; bidirectional heartbeats active.
3. **`RECONNECTING`**: Socket disconnected unexpectedly; backoff timer running; attempting new connection.
4. **`RESYNCING`**: TCP socket re-opened; auth token submitted; waiting for `room.snapshot` to replace stale state.
5. **`DISCONNECTED`**: Intentional user departure; socket closed cleanly with code 1000.
6. **`FAILED`**: Terminal state after 8 unsuccessful reconnect attempts; user presented with manual retry UI.

---

## 3. Exponential Backoff with Decorrelated Jitter

To prevent server stampedes when a network gateway or WiFi access point recovers, the client applies exponential backoff with randomized jitter (`frontend/src/lib/realtime.ts`):

$$\text{BaseDelay} = \min(15000\text{ms}, 500\text{ms} \times 2^{\max(0, \text{retry} - 1)})$$
$$\text{ActualDelay} = \text{BaseDelay} \times (0.75 + \text{random}() \times 0.5)$$

```typescript
export function reconnectDelay(retry: number, random = Math.random()): number {
  const base = Math.min(15_000, 500 * 2 ** Math.max(0, retry - 1));
  return base * (0.75 + random * 0.5); // Jitter range: 75% to 125% of base
}
```

- **Max Retries**: 8 attempts over ~75 seconds before transitioning to `FAILED`.
- **Duplicate Prevention**: A reload retains its per-tab session ID, so its new connection atomically replaces the prior active connection. A different tab has a different ID and receives `error: DUPLICATE_SESSION`, preventing multi-tab state corruption.

---

## 4. Separation of WebSocket and LiveKit Reconnection

WebSocket (control plane) and LiveKit (media plane) operate on completely independent network connections:

| Layer | Connection Type | Reconnection Owner | Reconnection Behavior |
| :--- | :--- | :--- | :--- |
| **Control Plane** | WebSocket (`/ws`) | `RoomSocket` class | Reconnects via exponential backoff, refreshes Supabase JWT if expired, fetches `room.snapshot`. |
| **Media Plane** | WebRTC (LiveKit SFU) | `@livekit/components-react` | LiveKit SDK handles ICE renegotiation, candidate gathering, and RTP track resumption independently. |

- If LiveKit experiences transient packet loss while WebSocket remains healthy: Chat and media sync continue unaffected.
- If WebSocket reconnects while LiveKit stays connected: The media dock continues streaming while chat/room state refreshes.

---

## 5. End-to-End Snapshot Replacement Sequence

Upon transitioning from `RECONNECTING` to `RESYNCING`:
1. **Auth Token Refresh**: If user is authenticated, the client acquires a fresh Supabase access token via `supabase.auth.getSession()` before connecting.
2. **WebSocket Upgrade**: Socket opens; client sends `connection.auth { token, room_id }`.
3. **Snapshot Reception**: Server responds with `room.snapshot`.
4. **Atomic Store Replacement**:
   - `useRoomStore.getState().applySnapshot(payload)`: Overwrites participants and room flags.
   - `useChatStore.getState().replace(payload.messages)`: Resets recent message history.
   - `useMusicStore.getState().replaceMedia(payload.media)`: Resets playback anchor and queue.
5. **State Transition**: `RoomSocket` clears retry counters, resets deadlines, and fires `onState("CONNECTED")`.
