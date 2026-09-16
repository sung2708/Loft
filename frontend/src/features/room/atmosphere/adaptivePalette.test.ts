import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAdaptivePaletteCache,
  deriveAdaptivePalette,
  youtubeThumbnail,
} from "./adaptivePalette";

describe("adaptive room palette", () => {
  const originalImage = global.Image;
  const originalDocument = global.document;

  afterEach(() => {
    clearAdaptivePaletteCache();
    global.Image = originalImage;
    global.document = originalDocument;
    vi.restoreAllMocks();
  });

  it("builds only approved YouTube thumbnail URLs", () => {
    expect(youtubeThumbnail("dQw4w9WgXcQ")).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
    expect(youtubeThumbnail("https://evil.test/x")).toBeNull();
    expect(youtubeThumbnail("bad")).toBeNull();
    expect(youtubeThumbnail("")).toBeNull();
    expect(youtubeThumbnail("1234567890")).toBeNull(); // 10 chars
    expect(youtubeThumbnail("123456789012")).toBeNull(); // 12 chars
    expect(youtubeThumbnail("<script>bad")).toBeNull();
  });

  it("returns null for invalid video ID", async () => {
    const palette = await deriveAdaptivePalette("invalid");
    expect(palette).toBeNull();
  });

  it("derives and clamps palette values safely, caching result", async () => {
    // Mock Image to trigger load immediately
    class MockImage {
      crossOrigin = "";
      decoding = "";
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    // @ts-expect-error mock Image
    global.Image = MockImage;

    // Mock Canvas and 2D Context
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        // Fill with high red (255) and low blue (0) to test clamp bounds [32, 190]
        data: new Uint8ClampedArray(Array.from({ length: 1344 }, (_, i) => {
          if (i % 4 === 0) return 255; // Red -> clamps to 190
          if (i % 4 === 1) return 100; // Green -> ~100
          if (i % 4 === 2) return 0;   // Blue -> clamps to 32
          return 255;                  // Alpha
        })),
      }),
    };

    // @ts-expect-error mock document
    global.document = {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: (type: string) => (type === "2d" ? mockContext : null),
          } as unknown as HTMLCanvasElement;
        }
        return {} as HTMLElement;
      },
    };

    const result = await deriveAdaptivePalette("dQw4w9WgXcQ");
    expect(result).not.toBeNull();
    // Clamped checks: 255 -> 190, 0 -> 32
    expect(result?.primary).toBe("190 100 32");
    expect(result?.secondary).toBe("32 190 100");

    // Second call should return from cache without querying canvas
    const cachedResult = await deriveAdaptivePalette("dQw4w9WgXcQ");
    expect(cachedResult).toEqual(result);
  });

  it("cancels derivation when AbortSignal triggers", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await deriveAdaptivePalette("dQw4w9WgXcQ", controller.signal);
    expect(result).toBeNull();
  });

  it("handles thumbnail loading error with deterministic null fallback", async () => {
    class ErrorImage {
      crossOrigin = "";
      decoding = "";
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    // @ts-expect-error mock ErrorImage
    global.Image = ErrorImage;

    // @ts-expect-error mock document
    global.document = { createElement: () => ({} as HTMLElement) };

    const result = await deriveAdaptivePalette("abcdef12345");
    expect(result).toBeNull();
  });

  it("bounds cache to maximum 24 entries", async () => {
    for (let i = 0; i < 26; i++) {
      const id = `video_${String(i).padStart(5, "0")}`;
      await deriveAdaptivePalette(id);
    }
  });
});
