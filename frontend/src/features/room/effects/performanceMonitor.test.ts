import { describe, expect, it } from "vitest";
import { EffectPerformanceMonitor, TIER_CONFIG } from "./performanceMonitor";

describe("effect performance monitor", () => {
  it("steps down after sustained slow samples and observes hysteresis", () => {
    const monitor = new EffectPerformanceMonitor();
    for (let i = 0; i < 30; i++) monitor.record(40, 20_000);
    expect(monitor.tier).toBe("medium");
    for (let i = 0; i < 30; i++) monitor.record(40, 20_100);
    expect(monitor.tier).toBe("medium");
  });

  it("opens a capability circuit after two failures", () => {
    const monitor = new EffectPerformanceMonitor();
    expect(monitor.recordFailure("segmentation")).toBe(false);
    expect(monitor.recordFailure("segmentation")).toBe(true);
    expect(monitor.isCircuitOpen("segmentation")).toBe(true);
  });

  it("keeps vision inference below the output frame rate at every active tier", () => {
    for (const tier of [TIER_CONFIG.high, TIER_CONFIG.medium, TIER_CONFIG.low]) {
      expect(tier.inferenceFps).toBeLessThan(tier.outputFps);
    }
  });
});
