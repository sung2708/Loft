import { beforeEach, describe, expect, it } from "vitest";
import {
  finishCallStats,
  noteCallReconnect,
  readPendingFeedback,
  resetCallStats,
  sampleCallQuality,
  startCallStats,
} from "./callStats";
import type { RoomCredential } from "@/types/api";

const storage = new Map<string, string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});

const credential: RoomCredential = { token: "t", type: "guest", roomId: "room", displayName: "A" };

describe("callStats", () => {
  beforeEach(() => {
    storage.clear();
    resetCallStats();
  });

  it("queues aggregated stats for calls of at least a minute", () => {
    startCallStats("room", 0);
    startCallStats("room", 50_000); // reconnect must not reset the call
    for (const sample of ["excellent", "good", "poor", "lost", "unknown"] as const)
      sampleCallQuality(sample);
    noteCallReconnect();
    const pending = finishCallStats(credential, 120_000);
    expect(pending?.stats).toEqual({
      duration_seconds: 120,
      samples_good: 2,
      samples_poor: 1,
      samples_lost: 1,
      reconnects: 1,
    });
    expect(readPendingFeedback(130_000)?.roomId).toBe("room");
    expect(readPendingFeedback(130_000 + 10 * 60 * 1000)).toBeNull();
  });

  it("skips short calls and calls for another room", () => {
    startCallStats("room", 0);
    expect(finishCallStats(credential, 30_000)).toBeNull();
    startCallStats("other", 0);
    expect(finishCallStats(credential, 600_000)).toBeNull();
    expect(readPendingFeedback()).toBeNull();
  });
});
