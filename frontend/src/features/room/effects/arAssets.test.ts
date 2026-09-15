import { describe, expect, it } from "vitest";
import { calculateARPlacements } from "./arAssets";

const landmarks = () => {
  const points = Array.from({ length: 264 }, () => ({ x: 0.5, y: 0.5 }));
  points[33] = { x: 0.35, y: 0.5 };
  points[263] = { x: 0.65, y: 0.5 };
  return points;
};

describe("calculateARPlacements", () => {
  it.each(["cat-ears", "bunny", "crown", "glasses", "bloom", "starry", "cloudy"] as const)(
    "creates one anchored placement for %s",
    (effect) => {
      const placements = calculateARPlacements(effect, landmarks(), 1000, 800);
      expect(placements).toHaveLength(1);
      expect(placements[0].asset).toBe(effect);
      expect(placements[0].size).toBeGreaterThan(0);
    },
  );

  it("anchors head accessories above the eye midpoint", () => {
    const [kitty] = calculateARPlacements("cat-ears", landmarks(), 1000, 800);
    const [crown] = calculateARPlacements("crown", landmarks(), 1000, 800);
    expect(kitty.centerX).toBe(500);
    expect(kitty.centerY).toBeLessThan(400);
    expect(crown.centerY).toBeLessThan(kitty.centerY);
  });

  it("uses independent cheek assets for blush", () => {
    const placements = calculateARPlacements("blush", landmarks(), 1000, 800);
    expect(placements.map(({ asset }) => asset)).toEqual(["blush-left", "blush-right"]);
    expect(placements[0].centerX).toBeLessThan(placements[1].centerX);
  });

  it("rotates placements with the eye line", () => {
    const points = landmarks();
    points[33] = { x: 0.4, y: 0.4 };
    points[263] = { x: 0.6, y: 0.5 };
    const [glasses] = calculateARPlacements("glasses", points, 1000, 1000);
    expect(glasses.rotation).toBeCloseTo(Math.atan2(100, 200));
  });

  it("removes animation when reduced motion is enabled", () => {
    const still = calculateARPlacements("cloudy", landmarks(), 1000, 800, 500, true);
    const animated = calculateARPlacements("cloudy", landmarks(), 1000, 800, 500, false);
    expect(still[0].centerY).not.toBe(animated[0].centerY);
  });

  it("returns no placement without usable landmarks", () => {
    expect(calculateARPlacements("cat-ears", [], 1000, 800)).toEqual([]);
    expect(calculateARPlacements("cat-ears", [{ x: 0.5, y: 0.5 }], 0, 800)).toEqual([]);
  });
});
