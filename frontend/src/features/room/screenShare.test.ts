import { describe, expect, it } from "vitest";
import { hasActiveScreenShare } from "./screenShare";

describe("hasActiveScreenShare", () => {
  it("activates the screen-focused presentation for a published share", () => {
    expect(hasActiveScreenShare([{ publication: { isMuted: false } }])).toBe(true);
  });

  it("does not activate for unpublished or muted screen tracks", () => {
    expect(hasActiveScreenShare([])).toBe(false);
    expect(hasActiveScreenShare([{ publication: null }])).toBe(false);
    expect(hasActiveScreenShare([{ publication: { isMuted: true } }])).toBe(false);
  });
});
