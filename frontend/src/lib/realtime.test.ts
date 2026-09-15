import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomSocket } from "./realtime";

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 1;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  send = vi.fn();
  close = vi.fn(); // A half-open network can delay the browser close event.
  constructor() { TestSocket.instances.push(this); }
  receive(type: string, payload = {}) { this.onmessage?.({ data: JSON.stringify({ type, payload }) }); }
}
const credential = { type: "user" as const, token: "old", roomId: "room", displayName: "QA" };
beforeEach(() => { vi.useFakeTimers(); TestSocket.instances = []; vi.stubGlobal("WebSocket", TestSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("room socket recovery", () => {
  it("refreshes credentials on reconnect and gates commands on the snapshot", async () => {
    const getCredential = vi.fn().mockResolvedValueOnce(credential).mockResolvedValue({ ...credential, token: "fresh" });
    const socket = new RoomSocket(credential, { onEvent: vi.fn(), onState: vi.fn(), getCredential });
    await socket.connect();
    const first = TestSocket.instances[0];
    first.onopen?.();
    expect(socket.send("chat.send", { content: "no" })).toBe(false);
    first.receive("room.snapshot");
    expect(socket.send("chat.send", { content: "yes" })).toBe(true);
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(700);
    const next = TestSocket.instances[1];
    next.onopen?.();
    expect(JSON.parse(next.send.mock.calls[0][0]).payload.token).toBe("fresh");
    expect(socket.send("chat.send", {})).toBe(false);
    socket.close();
  });

  it("recovers from a half-open connection without waiting for onclose", async () => {
    const socket = new RoomSocket(credential, { onEvent: vi.fn(), onState: vi.fn() });
    await socket.connect();
    const first = TestSocket.instances[0];
    first.onopen?.();
    first.receive("room.snapshot");
    await vi.advanceTimersByTimeAsync(51_000);
    expect(first.close).toHaveBeenCalled();
    expect(TestSocket.instances).toHaveLength(2);
    socket.close();
  });

  it("ignores a late credential result after leaving", async () => {
    let resolve!: (value: typeof credential) => void;
    const pending = new Promise<typeof credential>((done) => { resolve = done; });
    const socket = new RoomSocket(credential, { onEvent: vi.fn(), onState: vi.fn(), getCredential: () => pending });
    const connecting = socket.connect();
    socket.close();
    resolve(credential);
    await connecting;
    expect(TestSocket.instances).toHaveLength(0);
  });

  it("stops retrying a full room", async () => {
    const onState = vi.fn();
    const socket = new RoomSocket(credential, { onEvent: vi.fn(), onState });
    await socket.connect();
    TestSocket.instances[0].receive("error", { code: "ROOM_FULL" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(TestSocket.instances).toHaveLength(1);
    expect(onState).toHaveBeenLastCalledWith("FAILED", expect.stringContaining("full"));
  });

  it("stops retrying immediately after a host kick", async () => {
    const onState = vi.fn();
    const socket = new RoomSocket(credential, { onEvent: vi.fn(), onState });
    await socket.connect();
    const active = TestSocket.instances[0];
    active.receive("error", { code: "ROOM_KICKED", message: "Removed from room by host" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(TestSocket.instances).toHaveLength(1);
    expect(onState).toHaveBeenLastCalledWith("FAILED", "You were removed from this room");
    expect(socket.send("chat.send", {})).toBe(false);
  });
});
