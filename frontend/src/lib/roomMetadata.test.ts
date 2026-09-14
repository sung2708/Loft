import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRoomMetadata } from "./roomMetadata";

afterEach(() => vi.unstubAllGlobals());

describe("shared room metadata", () => {
  it("includes the room name and ID in link previews", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "137fbc64-d27f-4f8e-b448-f830f466a152",
        slug: "late-night",
        name: "Late Night",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await generateRoomMetadata("late-night");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/rooms/late-night");
    expect(metadata.title).toBe("Late Night | Loft");
    expect(metadata.description).toContain("137fbc64-d27f-4f8e-b448-f830f466a152");
    expect(metadata.openGraph?.title).toBe(metadata.title);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it("uses generic metadata when the room cannot be resolved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("API unavailable")));
    const metadata = await generateRoomMetadata("late-night");
    expect(metadata.title).toBe("Join a room | Loft");
    expect(metadata.description).not.toContain("late-night");
  });

  it("rejects invalid identifiers before requesting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await generateRoomMetadata("bad/identifier");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
