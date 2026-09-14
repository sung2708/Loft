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
        allow_guests: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await generateRoomMetadata("late-night");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/rooms/late-night");
    expect(metadata.title).toEqual({ absolute: "Late Night · Loft" });
    expect(metadata.description).toContain("137fbc64-d27f-4f8e-b448-f830f466a152");
    expect(metadata.openGraph?.title).toBe("Late Night · Loft");
    expect(metadata.description).toBe("Room 137fbc64-d27f-4f8e-b448-f830f466a152 on Loft — We’re here together.");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(JSON.stringify(metadata)).not.toContain("late-night");
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it("uses generic metadata when the room cannot be resolved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("API unavailable")));
    const metadata = await generateRoomMetadata("late-night");
    expect(metadata.title).toEqual({ absolute: "Loft — We’re here together." });
    expect(metadata.description).not.toContain("late-night");
  });

  it("falls back to the public ID when the room name is blank", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "K7M-4Q2", name: "  ", allow_guests: true }) }));
    expect((await generateRoomMetadata("K7M-4Q2")).title).toEqual({ absolute: "Room K7M-4Q2 · Loft" });
  });

  it.each([false, undefined])("does not expose rooms without explicit guest access (%s)", async (allow_guests) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: "private-id", name: "Private name", slug: "invite-secret", allow_guests,
      owner_id: "supabase-user", token: "guest-token", livekit_token: "media-token",
    }) }));
    const metadata = await generateRoomMetadata("invite-secret");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    for (const sensitive of ["private-id", "Private name", "invite-secret", "supabase-user", "guest-token", "media-token"]) {
      expect(JSON.stringify(metadata)).not.toContain(sensitive);
    }
    expect(metadata.openGraph?.title).toBe("Loft — We’re here together.");
  });

  it("rejects invalid identifiers before requesting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await generateRoomMetadata("bad/identifier");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
