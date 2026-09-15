export type BackgroundEffect = "none" | "blur" | "custom";
export type LookEffect = "natural" | "warm" | "monochrome";
export type AREffect = "none" | "cat-ears" | "bunny" | "crown" | "glasses" | "bloom" | "starry" | "cloudy" | "blush";
export type ProcessorStatus = "inactive" | "loading" | "active" | "unavailable" | "failed" | "fallback";
export type CapabilityStatus = "idle" | "loading" | "ready" | "unavailable" | "failed" | "circuit-open";
export type QualityTier = "high" | "medium" | "low" | "off";

export interface EffectSelection {
  background: BackgroundEffect;
  look: LookEffect;
  ar: AREffect;
  customBackgroundId?: string;
  generation: number;
}

export interface RequiredCapabilities {
  needsProcessor: boolean;
  needsSegmentation: boolean;
  needsFaceLandmarks: boolean;
  needsColorTransform: boolean;
  needsAnimation: boolean;
}

export interface CapabilityRuntime {
  state: CapabilityStatus;
  inferenceInFlight: boolean;
  consecutiveFailures: number;
  lastResultTimestamp?: number;
}

export interface ProcessorRuntime {
  status: ProcessorStatus;
  ownedGeneration?: number;
  sourceTrackId?: string;
  processedTrackId?: string;
  qualityTier: QualityTier;
  segmentation: CapabilityRuntime;
  faceLandmarks: CapabilityRuntime;
  lastFallbackReason?: "unsupported" | "initialization" | "runtime" | "performance" | "context-lost";
  disposed: boolean;
}

export interface EffectCapabilities {
  processor: boolean;
  segmentation: boolean;
  faceLandmarks: boolean;
  reason?: string;
}

export const DEFAULT_SELECTION: EffectSelection = {
  background: "none",
  look: "natural",
  ar: "none",
  generation: 0,
};

const idleCapability = (): CapabilityRuntime => ({
  state: "idle",
  inferenceInFlight: false,
  consecutiveFailures: 0,
});

export const DEFAULT_RUNTIME: ProcessorRuntime = {
  status: "inactive",
  qualityTier: "high",
  segmentation: idleCapability(),
  faceLandmarks: idleCapability(),
  disposed: false,
};
