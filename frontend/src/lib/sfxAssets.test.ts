import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sfxManifest } from "./sfx";

describe("SFX asset manifest", () => {
  it("references only shipped local assets", () => {
    for (const item of Object.values(sfxManifest)) {
      expect(item.src.startsWith("/sfx/")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", item.src))).toBe(true);
      expect(item.gain).toBeGreaterThan(0);
      expect(item.gain).toBeLessThanOrEqual(1);
    }
  });
});
