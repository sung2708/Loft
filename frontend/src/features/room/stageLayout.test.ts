import { describe, expect, it } from "vitest";
import { deriveStageLayout } from "./stageLayout";

describe("deriveStageLayout", () => {
  it("gives screen share priority regardless of participant count", () => {
    expect(deriveStageLayout(1, true, 1440, 800)).toEqual({ mode: "screen-share" });
    expect(deriveStageLayout(6, true, 375, 600)).toEqual({ mode: "screen-share" });
  });

  it("returns to solo after participants leave", () => {
    for (const count of [2, 3, 4, 6, 2]) {
      expect(deriveStageLayout(count, false, 1280, 720).mode).toBe("grid");
    }
    expect(deriveStageLayout(1, false, 1280, 720)).toEqual({ mode: "solo" });
  });

  it.each([1440, 1280, 1024, 768, 430, 375])(
    "keeps one participant solo at %ipx",
    (width) => {
      expect(deriveStageLayout(1, false, width, 700)).toEqual({ mode: "solo" });
    },
  );

  it("balances two and adapts three or four", () => {
    expect(deriveStageLayout(2, false, 1280, 720)).toEqual({ mode: "grid", columns: 2, rows: 1 });
    expect(deriveStageLayout(2, false, 375, 600)).toEqual({ mode: "grid", columns: 1, rows: 2 });
    expect(deriveStageLayout(3, false, 1024, 700)).toEqual({ mode: "grid", columns: 2, rows: 2 });
    expect(deriveStageLayout(4, false, 430, 700)).toEqual({ mode: "grid", columns: 1, rows: 4 });
  });

  it("selects a bounded responsive grid for five or more", () => {
    for (const width of [1440, 1280, 1024, 768, 430, 375]) {
      const layout = deriveStageLayout(7, false, width, 700);
      expect(layout.mode).toBe("grid");
      if (layout.mode === "grid") {
        expect(layout.columns).toBeGreaterThanOrEqual(1);
        expect(layout.columns).toBeLessThanOrEqual(6);
        expect(layout.rows * layout.columns).toBeGreaterThanOrEqual(7);
      }
    }
  });
});
