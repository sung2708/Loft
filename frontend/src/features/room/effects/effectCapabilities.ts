import {
  DEFAULT_SELECTION,
  type AREffect,
  type BackgroundEffect,
  type EffectCapabilities,
  type EffectSelection,
  type LookEffect,
  type RequiredCapabilities,
} from "./contracts";

const backgrounds = new Set<BackgroundEffect>(["none", "blur", "custom"]);
const looks = new Set<LookEffect>(["natural", "warm", "monochrome"]);
const ars = new Set<AREffect>(["none", "cat-ears", "bunny", "crown", "glasses", "bloom", "starry", "cloudy", "blush"]);
const animated = new Set<AREffect>(["cat-ears", "bunny", "crown", "bloom", "starry", "cloudy"]);

export function normalizeSelection(value: Partial<EffectSelection>): EffectSelection {
  const background = backgrounds.has(value.background as BackgroundEffect) ? value.background as BackgroundEffect : "none";
  const look = looks.has(value.look as LookEffect) ? value.look as LookEffect : "natural";
  const ar = ars.has(value.ar as AREffect) ? value.ar as AREffect : "none";
  return {
    ...DEFAULT_SELECTION,
    background,
    look,
    ar,
    generation: Number.isSafeInteger(value.generation) && (value.generation ?? -1) >= 0 ? value.generation! : 0,
    ...(background === "custom" && value.customBackgroundId ? { customBackgroundId: value.customBackgroundId } : {}),
  };
}

export function deriveCapabilities(selection: EffectSelection, reducedMotion = false): RequiredCapabilities {
  const needsSegmentation = selection.background === "blur" || selection.background === "custom";
  const needsFaceLandmarks = selection.ar !== "none";
  const needsColorTransform = selection.look !== "natural";
  return {
    needsProcessor: needsSegmentation || needsFaceLandmarks || needsColorTransform,
    needsSegmentation,
    needsFaceLandmarks,
    needsColorTransform,
    needsAnimation: animated.has(selection.ar) && !reducedMotion,
  };
}

export function detectEffectCapabilities(): EffectCapabilities {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { processor: false, segmentation: false, faceLandmarks: false, reason: "browser-only" };
  }
  const canvas = document.createElement("canvas");
  const capture = typeof canvas.captureStream === "function";
  const wasm = typeof WebAssembly !== "undefined";
  const graphics = Boolean(canvas.getContext("2d"));
  const secure = window.isSecureContext || window.location.hostname === "localhost";
  const processor = secure && capture && wasm && graphics;
  return {
    processor,
    segmentation: processor,
    faceLandmarks: processor,
    reason: processor ? undefined : "unsupported",
  };
}
