import { describe, expect, it } from "vitest";
import { canonicalPositionMs, driftCorrection } from "./mediaClock";

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

describe("YouTube drift correction", () => {
  const rates = [0.95, 1, 1.05];

  it("does not adjust natural drift and restores the normal speed once caught up", () => {
    expect(driftCorrection(1200, 1000, 1, rates)).toEqual({ kind: "none" });
    expect(driftCorrection(1030, 1000, 0.95, rates)).toEqual({ kind: "rate", rate: 1 });
  });

  it("slows ahead players and speeds up lagging players when supported", () => {
    expect(driftCorrection(1300, 1000, 1, rates)).toEqual({ kind: "rate", rate: 0.95 });
    expect(driftCorrection(700, 1000, 1, rates)).toEqual({ kind: "rate", rate: 1.05 });
    expect(driftCorrection(1100, 1000, 0.95, rates)).toEqual({ kind: "none" });
  });

  it("does not select unsupported YouTube playback rates", () => {
    expect(driftCorrection(1400, 1000, 1, [0.75, 1, 1.25])).toEqual({ kind: "none" });
    expect(driftCorrection(1400, 1000, 1.05, [0.75, 1, 1.25])).toEqual({ kind: "rate", rate: 1 });
  });

  it("seeks only beyond 1.5 seconds of drift", () => {
    expect(driftCorrection(2500, 1000, 1, rates)).toEqual({ kind: "rate", rate: 0.95 });
    expect(driftCorrection(2501, 1000, 0.95, rates)).toEqual({ kind: "seek", positionMs: 1000 });
  });
});
