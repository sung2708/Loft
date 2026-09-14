import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { useI18nStore } from "./i18n/useTranslation";

afterEach(() => vi.unstubAllGlobals());

describe("delete room API", () => {
  it("sends the owner's bearer token and accepts an empty 204 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.deleteRoom("owner-token", "room-id")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/rooms/room-id");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer owner-token");
  });

  it("keeps a busy-room conflict visible in Vietnamese", async () => {
    useI18nStore.getState().setLocale("vi");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: "ROOM_BUSY", message: "Room is active or being deleted" } }), { status: 409 })));
    await expect(api.deleteRoom("owner-token", "room-id")).rejects.toMatchObject({ code: "ROOM_BUSY", status: 409 });
    try {
      await api.deleteRoom("owner-token", "room-id");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toContain("Phòng đang có người tham gia");
    }
  });
});
