"use client";

import { create } from "zustand";

const STORAGE_KEY = "mingly.sfx.preferences";

export interface SfxPreferences {
  soundEffectsEnabled: boolean;
  roomSoundsEnabled: boolean;
  volume: number;
}

interface SfxState extends SfxPreferences {
  hydrated: boolean;
  hydrate: () => void;
  setSoundEffectsEnabled: (enabled: boolean) => void;
  setRoomSoundsEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
}

const defaults: SfxPreferences = {
  soundEffectsEnabled: true,
  roomSoundsEnabled: true,
  volume: 80,
};

const clampVolume = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : defaults.volume;

function save(preferences: SfxPreferences) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
  } catch {
    // Preferences are optional; storage failure must not affect a room.
  }
}

export const useSfxStore = create<SfxState>((set, get) => ({
  ...defaults,
  hydrated: false,
  hydrate: () => {
    if (typeof localStorage === "undefined" || get().hydrated) return;
    let preferences = defaults;
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<SfxPreferences>;
      preferences = {
        soundEffectsEnabled: typeof value.soundEffectsEnabled === "boolean" ? value.soundEffectsEnabled : defaults.soundEffectsEnabled,
        roomSoundsEnabled: typeof value.roomSoundsEnabled === "boolean" ? value.roomSoundsEnabled : defaults.roomSoundsEnabled,
        volume: clampVolume(value.volume ?? defaults.volume),
      };
    } catch {
      // Invalid optional state falls back to safe defaults.
    }
    set({ ...preferences, hydrated: true });
  },
  setSoundEffectsEnabled: (soundEffectsEnabled) => {
    set({ soundEffectsEnabled });
    save({ ...get(), soundEffectsEnabled });
  },
  setRoomSoundsEnabled: (roomSoundsEnabled) => {
    set({ roomSoundsEnabled });
    save({ ...get(), roomSoundsEnabled });
  },
  setVolume: (value) => {
    const volume = clampVolume(value);
    set({ volume });
    save({ ...get(), volume });
  },
}));
