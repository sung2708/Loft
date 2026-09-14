import { beforeEach, describe, expect, it } from "vitest";
import { parseRoomMedia, useMusicStore } from "./useMusicStore";

const valid = {
  current: null,
  queue: [],
  repeat: false,
  status: "IDLE",
  position_ms: 0,
  started_at: "0001-01-01T00:00:00Z",
  version: 1,
};

describe("music state from WebSocket", () => {
  beforeEach(() => useMusicStore.getState().reset());

  it("keeps room usable when an old server omits media", () => {
    useMusicStore.getState().replaceMedia(undefined);
    const state = useMusicStore.getState();
    expect(state.media.version).toBe(0);
    expect(state.media.queue).toEqual([]);
    expect(state.available).toBe(false);
    expect(state.error).toContain("Restart the Go server");
  });

  it("accepts valid media and ignores malformed/stale updates", () => {
    useMusicStore.getState().replaceMedia(valid);
    expect(useMusicStore.getState().available).toBe(true);
    useMusicStore.getState().setMedia({ ...valid, version: 0 });
    expect(useMusicStore.getState().media.version).toBe(1);
    useMusicStore.getState().setMedia(undefined);
    expect(useMusicStore.getState().media.version).toBe(1);
    expect(parseRoomMedia({ ...valid, queue: [null] })).toBeNull();
  });
});
