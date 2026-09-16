import { describe, expect, it } from "vitest";
import { shouldUseAdaptiveTreatment } from "./degradation";

describe("atmosphere degradation", () => {
  it.each([
    { reducedMotion: true, saveData: false, constrainedDevice: false },
    { reducedMotion: false, saveData: true, constrainedDevice: false },
    { reducedMotion: false, saveData: false, constrainedDevice: true },
  ])("disables adaptive work for constrained capability %#", (capabilities) => {
    expect(shouldUseAdaptiveTreatment(capabilities)).toBe(false);
  });

  it("allows one-shot adaptive work on an unconstrained device", () => {
    expect(shouldUseAdaptiveTreatment({ reducedMotion: false, saveData: false, constrainedDevice: false })).toBe(true);
  });
});
