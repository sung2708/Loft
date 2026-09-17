import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusicPlayerStore } from "./useMusicPlayerStore";

describe("music player device state", () => {
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    useMusicPlayerStore.setState({
      volume: 80,
      activated: false,
      activationRequested: false,
      playerReady: false,
      currentTime: 0,
      duration: 0,
      hydrated: false,
      audioActivationHandler: null,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists device volume while clearing room-specific player runtime", () => {
    useMusicPlayerStore.getState().setVolume(47.4);
    expect(useMusicPlayerStore.getState().volume).toBe(47);
    expect(stored).toContain('"volume":47');

    useMusicPlayerStore.setState({ volume: 80, hydrated: false });
    useMusicPlayerStore.getState().hydrate();
    expect(useMusicPlayerStore.getState().volume).toBe(47);

    useMusicPlayerStore.setState({
      activated: true,
      playerReady: true,
      currentTime: 23,
      duration: 180,
    });
    useMusicPlayerStore.getState().resetPlayback();

    expect(useMusicPlayerStore.getState()).toMatchObject({
      volume: 47,
      activated: false,
      activationRequested: false,
      playerReady: false,
      currentTime: 0,
      duration: 0,
    });
  });

  it("remembers an activation request until a player is ready, then uses a direct handler", () => {
    expect(useMusicPlayerStore.getState().requestAudioActivation()).toBe(false);
    expect(useMusicPlayerStore.getState()).toMatchObject({
      activated: false,
      activationRequested: true,
    });

    const activate = vi.fn(() => true);
    useMusicPlayerStore.getState().setAudioActivationHandler(activate);

    expect(useMusicPlayerStore.getState().requestAudioActivation()).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(useMusicPlayerStore.getState()).toMatchObject({
      activated: true,
      activationRequested: false,
    });
  });
});
