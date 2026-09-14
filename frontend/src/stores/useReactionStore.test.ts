import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReactionStore } from "./useReactionStore";

describe("reaction aggregation", () => {
  beforeEach(() => { useReactionStore.getState().reset(); vi.useFakeTimers(); });

  it("groups simultaneous reactions and bounds visible groups", () => {
    for (let i = 0; i < 30; i++) useReactionStore.getState().append({ emoji: "👏", displayName: `Person ${i}` });
    expect(useReactionStore.getState().reactions).toHaveLength(1);
    expect(useReactionStore.getState().reactions[0].count).toBe(30);
    for (const emoji of ["❤️", "🔥", "😂", "👍", "🎉", "🙂", "🙌"]) useReactionStore.getState().append({ emoji, displayName: "Person" });
    expect(useReactionStore.getState().reactions.length).toBeLessThanOrEqual(6);
    vi.advanceTimersByTime(3000);
    useReactionStore.getState().clearExpired(Date.now());
    expect(useReactionStore.getState().reactions).toHaveLength(0);
    vi.useRealTimers();
  });
});
