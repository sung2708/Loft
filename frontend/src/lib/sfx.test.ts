import { beforeEach, describe, expect, it } from "vitest";
import { SfxManager } from "./sfx";
import { useSfxStore } from "@/stores/useSfxStore";

function fakeAudio() {
  return {
    volume: 0,
    currentTime: 0,
    play: async () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
  };
}

describe("SfxManager", () => {
  beforeEach(() => useSfxStore.setState({ soundEffectsEnabled: true, roomSoundsEnabled: true, volume: 60, hydrated: true }));

  it("requires unlock and bounds simultaneous voices", () => {
    const manager = new SfxManager(() => fakeAudio(), 2);
    manager.play("mute");
    expect(manager.activeVoices).toBe(0);
    manager.unlock();
    manager.play("mute");
    manager.play("unmute");
    manager.play("camera-on");
    expect(manager.activeVoices).toBe(2);
    manager.stopAll();
    expect(manager.activeVoices).toBe(0);
  });

  it("respects category preference", () => {
    const manager = new SfxManager(() => fakeAudio());
    manager.unlock();
    useSfxStore.setState({ soundEffectsEnabled: false });
    manager.play("mute");
    manager.play("participant-join");
    expect(manager.activeVoices).toBe(1);
  });

  it("releases a voice when playback is blocked", async () => {
    const manager = new SfxManager(() => ({
      ...fakeAudio(),
      play: async () => { throw new Error("NotAllowedError"); },
    }));
    manager.unlock();
    manager.play("mute");
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.activeVoices).toBe(0);
  });
});
