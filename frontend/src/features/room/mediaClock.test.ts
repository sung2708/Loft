import { describe, expect, it } from "vitest";
import { canonicalPositionMs } from "./mediaClock";

describe("canonical media position", () => {
  const startedAt = "2026-09-14T10:00:00.000Z";
  const now = Date.parse(startedAt) + 3000;
  it("advances only while playing", () => {
    expect(canonicalPositionMs(1200, startedAt, "PLAYING", now)).toBe(4200);
    expect(canonicalPositionMs(1200, startedAt, "PAUSED", now)).toBe(1200);
  });
  it("does not rewind on clock skew", () => {
    expect(canonicalPositionMs(1200, startedAt, "PLAYING", now - 5000)).toBe(1200);
  });
});
