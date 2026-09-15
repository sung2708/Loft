import { describe, expect, it, vi } from "vitest";
import { deriveCapabilities, detectEffectCapabilities, normalizeSelection } from "./effectCapabilities";
import { DEFAULT_SELECTION } from "./contracts";

describe("video effect capabilities", () => {
  it("normalizes unknown values to safe defaults", () => {
    expect(normalizeSelection({ background: "bad" as never, look: "bad" as never, ar: "bad" as never })).toEqual(DEFAULT_SELECTION);
  });

  it("activates only required expensive capabilities", () => {
    expect(deriveCapabilities({ ...DEFAULT_SELECTION, background: "blur" })).toMatchObject({ needsSegmentation: true, needsFaceLandmarks: false });
    expect(deriveCapabilities({ ...DEFAULT_SELECTION, look: "warm" })).toMatchObject({ needsSegmentation: false, needsFaceLandmarks: false, needsColorTransform: true });
    expect(deriveCapabilities({ ...DEFAULT_SELECTION, ar: "glasses" })).toMatchObject({ needsSegmentation: false, needsFaceLandmarks: true });
    expect(deriveCapabilities({ ...DEFAULT_SELECTION, ar: "starry" }).needsAnimation).toBe(true);
    expect(deriveCapabilities({ ...DEFAULT_SELECTION, ar: "starry" }, true).needsAnimation).toBe(false);
  });

  it("reports unsupported outside a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(detectEffectCapabilities().processor).toBe(false);
    vi.unstubAllGlobals();
  });
});
