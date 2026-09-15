import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeCustomBackground, MAX_BACKGROUND_BYTES, MAX_BACKGROUND_DIMENSION } from "./customBackground";

describe("custom backgrounds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects unsupported and oversized inputs before decode", async () => {
    await expect(decodeCustomBackground(new File(["x"], "x.svg", { type: "image/svg+xml" }))).rejects.toThrow("unsupported");
    const huge = { type: "image/png", size: MAX_BACKGROUND_BYTES + 1 } as File;
    await expect(decodeCustomBackground(huge)).rejects.toThrow("size");
  });

  it("accepts decoded pixels and revokes its URL exactly once", async () => {
    const close = vi.fn();
    const revoke = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1200, height: 800, close }));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:local"), revokeObjectURL: revoke });
    vi.stubGlobal("crypto", { randomUUID: () => "opaque-id" });
    const resource = await decodeCustomBackground(new File(["ok"], "photo.webp", { type: "image/webp" }));
    expect(resource).toMatchObject({ id: "opaque-id", width: 1200, height: 800 });
    resource.dispose(); resource.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("rejects excessive decoded dimensions and revokes immediately", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: MAX_BACKGROUND_DIMENSION + 1, height: 10, close: vi.fn() }));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:large"), revokeObjectURL: revoke });
    await expect(decodeCustomBackground(new File(["x"], "large.png", { type: "image/png" }))).rejects.toThrow("dimensions");
    expect(revoke).toHaveBeenCalledWith("blob:large");
  });
});
