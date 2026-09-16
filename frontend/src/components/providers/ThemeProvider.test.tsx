import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/stores/useUIStore";
import { useRoomStore } from "@/stores/useRoomStore";
import type { RoomSnapshot } from "@/types/api";

describe("ThemeProvider and room atmosphere independence", () => {
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    useUIStore.setState({ theme: "system" });
    useRoomStore.getState().reset();
    let store: Record<string, string> = { "loft.theme": "dark" };
    // @ts-expect-error mock localStorage
    global.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  });

  afterEach(() => {
    global.localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  it("persists personal theme independently of room appearance snapshots and events", () => {
    // 1. Initial user personal theme is set to dark
    useUIStore.getState().setTheme("dark");
    localStorage.setItem("loft.theme", "dark");
    expect(localStorage.getItem("loft.theme")).toBe("dark");

    // 2. Snapshot with Ambient + Blue arrives
    const snapshot: RoomSnapshot = {
      room: {
        id: "room-test",
        slug: "123456",
        name: "Test Room",
        owner_id: "owner",
        allow_guests: true,
        max_participants: 12,
        is_locked: false,
        password_required: false,
        atmosphere: "ambient",
        accent: "blue",
        adaptive_media_background: true,
        version: 1,
        created_at: "2026-09-15T00:00:00Z",
      },
      host: {
        connection_id: "conn-1",
        identity_id: "owner",
        identity_type: "user",
        generation: 1,
        version: 1,
        state: "connected",
      },
      self: {
        connection_id: "conn-1",
        identity_id: "owner",
        identity_type: "user",
        display_name: "Host",
        role: "host",
        livekit_identity: "user:owner",
        joined_at: "2026-09-15T00:00:00Z",
      },
      participants: [],
      messages: [],
    };
    useRoomStore.getState().applySnapshot(snapshot);

    // Personal theme must remain dark
    expect(useUIStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("loft.theme")).toBe("dark");

    // 3. Room appearance updated event arrives (Party + Rose)
    useRoomStore.getState().roomAppearanceUpdated({
      atmosphere: "party",
      accent: "rose",
      adaptive_media_background: false,
      version: 2,
    });

    // Personal theme and localStorage key loft.theme must remain unchanged
    expect(useUIStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("loft.theme")).toBe("dark");

    // 4. Changing personal theme does not affect room appearance
    useUIStore.getState().setTheme("light");
    localStorage.setItem("loft.theme", "light");
    expect(useUIStore.getState().theme).toBe("light");
    expect(localStorage.getItem("loft.theme")).toBe("light");
    expect(useRoomStore.getState().room?.atmosphere).toBe("party");
    expect(useRoomStore.getState().room?.accent).toBe("rose");
  });

  it("system theme setting continues to track without room interference", () => {
    useUIStore.getState().setTheme("system");
    expect(useUIStore.getState().theme).toBe("system");

    // Room appearance arrives
    useRoomStore.getState().roomAppearanceUpdated({
      atmosphere: "focus",
      accent: "green",
      adaptive_media_background: true,
      version: 5,
    });

    // Theme still reports system
    expect(useUIStore.getState().theme).toBe("system");
  });
});
