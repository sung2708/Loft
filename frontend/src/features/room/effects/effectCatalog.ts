import type { AREffect, BackgroundEffect, LookEffect } from "./contracts";

export const BACKGROUNDS: ReadonlyArray<{ id: BackgroundEffect; label: string }> = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "custom", label: "Custom" },
];

export const LOOKS: ReadonlyArray<{ id: LookEffect; label: string }> = [
  { id: "natural", label: "Natural" },
  { id: "warm", label: "Warm" },
  { id: "monochrome", label: "Black & White" },
];

export const AR_EFFECTS: ReadonlyArray<{ id: AREffect; label: string }> = [
  { id: "none", label: "None" },
  { id: "cat-ears", label: "Kitty" },
  { id: "bunny", label: "Bunny" },
  { id: "crown", label: "Tiny Crown" },
  { id: "glasses", label: "Glasses" },
  { id: "bloom", label: "Bloom" },
  { id: "starry", label: "Starry" },
  { id: "cloudy", label: "Cloudy" },
  { id: "blush", label: "Tiny Blush" },
];
