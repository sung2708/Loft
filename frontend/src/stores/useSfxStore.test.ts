import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSfxStore } from "./useSfxStore";

describe("SFX preferences", () => {
  beforeEach(() => {
    let stored: string | null = null;
    vi.stubGlobal("localStorage", {
      getItem() { return stored; },
      setItem(_key: string, value: string) { stored = value; },
    });
    useSfxStore.setState({ soundEffectsEnabled: true, roomSoundsEnabled: true, volume: 60, hydrated: false });
  });

  it("uses safe defaults and clamps volume", () => {
    useSfxStore.getState().hydrate();
    expect(useSfxStore.getState()).toMatchObject({ soundEffectsEnabled: true, roomSoundsEnabled: true, volume: 60 });
    useSfxStore.getState().setVolume(140);
    expect(useSfxStore.getState().volume).toBe(100);
  });

  it("keeps room and UI categories independent", () => {
    useSfxStore.getState().setSoundEffectsEnabled(false);
    expect(useSfxStore.getState().roomSoundsEnabled).toBe(true);
  });
});
