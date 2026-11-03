import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: null as { access_token: string; user: { id: string } } | null,
  unsubscribe: vi.fn(),
  signOut: vi.fn(async () => ({ error: null as Error | null })),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: auth.session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: auth.unsubscribe } } }),
      signOut: auth.signOut,
    },
  }),
  signInWithGoogle: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  api: { me: async () => null },
  clearRoomCredentials: vi.fn(),
}));

import { useAuthStore } from "./useAuth";

afterEach(() => {
  auth.session = null;
  auth.unsubscribe.mockClear();
  auth.signOut.mockReset();
  auth.signOut.mockResolvedValue({ error: null });
  vi.unstubAllGlobals();
});

describe("auth restoration", () => {
  it("reloads the session when Back restores a pre-login page", async () => {
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const cleanup = useAuthStore.getState().initializeAuth();
    await vi.waitFor(() => expect(useAuthStore.getState().authState.status).toBe("anonymous"));

    auth.session = { access_token: "token", user: { id: "user" } };
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    page.dispatchEvent(restored);

    await vi.waitFor(() => expect(useAuthStore.getState().authState.status).toBe("authenticated"));
    cleanup();
  });

  it("removes the pageshow listener after the last subscriber leaves", async () => {
    const page = new EventTarget();
    const remove = vi.spyOn(page, "removeEventListener");
    vi.stubGlobal("window", page);
    const first = useAuthStore.getState().initializeAuth();
    const second = useAuthStore.getState().initializeAuth();
    first();
    expect(auth.unsubscribe).not.toHaveBeenCalled();
    second();
    expect(auth.unsubscribe).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("pageshow", expect.any(Function));
  });

  it("keeps authenticated state when sign out fails", async () => {
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    auth.session = { access_token: "token", user: { id: "user" } };
    const cleanup = useAuthStore.getState().initializeAuth();
    await vi.waitFor(() => expect(useAuthStore.getState().authState.status).toBe("authenticated"));
    auth.signOut.mockResolvedValue({ error: new Error("network") });
    await expect(useAuthStore.getState().signOut()).rejects.toThrow("network");
    expect(useAuthStore.getState().authState.status).toBe("authenticated");
    cleanup();
  });
});
