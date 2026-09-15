import type { QualityTier } from "./contracts";

const order: QualityTier[] = ["high", "medium", "low", "off"];

export class EffectPerformanceMonitor {
  private samples: number[] = [];
  private lastTransition = -Infinity;
  private failures = new Map<string, number>();
  tier: QualityTier = "high";

  record(durationMs: number, now = performance.now()): QualityTier {
    this.samples.push(Math.max(0, durationMs));
    if (this.samples.length > 60) this.samples.shift();
    if (this.samples.length >= 30 && now - this.lastTransition >= 15_000) {
      const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
      if (average > 28) this.stepDown(now);
    }
    return this.tier;
  }

  recordFailure(capability: string): boolean {
    const count = (this.failures.get(capability) ?? 0) + 1;
    this.failures.set(capability, count);
    return count >= 2;
  }

  recordSuccess(capability: string) { this.failures.set(capability, 0); }
  isCircuitOpen(capability: string) { return (this.failures.get(capability) ?? 0) >= 2; }

  private stepDown(now: number) {
    this.tier = order[Math.min(order.indexOf(this.tier) + 1, order.length - 1)];
    this.lastTransition = now;
    this.samples = [];
  }
}

export const TIER_CONFIG = {
  high: { width: 960, height: 540, outputFps: 30, inferenceFps: 15 },
  medium: { width: 640, height: 360, outputFps: 24, inferenceFps: 10 },
  low: { width: 480, height: 270, outputFps: 15, inferenceFps: 6 },
  off: { width: 0, height: 0, outputFps: 0, inferenceFps: 0 },
} as const;
