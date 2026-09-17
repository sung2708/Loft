"use client";

import { create } from "zustand";

const STORAGE_KEY = "mingly.music.player.preferences";

const DEFAULT_VOLUME = 80;

type AudioActivationHandler = () => boolean;

interface MusicPlayerPreferences {
  volume: number;
}

interface MusicPlayerState extends MusicPlayerPreferences {
  /** Whether this browser has successfully enabled audio for this room. */
  activated: boolean;
  /** A click requested audio before the YouTube player had finished loading. */
  activationRequested: boolean;
  playerReady: boolean;
  currentTime: number;
  duration: number;
  hydrated: boolean;
  hydrate: () => void;
  setVolume: (volume: number) => void;
  setActivated: (activated: boolean) => void;
  setPlayerReady: (playerReady: boolean) => void;
  setPlaybackProgress: (currentTime: number, duration: number) => void;
  requestAudioActivation: () => boolean;
  setAudioActivationHandler: (handler: AudioActivationHandler | null) => void;
  resetPlayback: () => void;
  audioActivationHandler: AudioActivationHandler | null;
}

function clampVolume(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : DEFAULT_VOLUME;
}

function save(preferences: MusicPlayerPreferences) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
  } catch {
    // Device preferences are optional and must never interrupt room playback.
  }
}

export const useMusicPlayerStore = create<MusicPlayerState>((set, get) => ({
  volume: DEFAULT_VOLUME,
  activated: false,
  activationRequested: false,
  playerReady: false,
  currentTime: 0,
  duration: 0,
  hydrated: false,
  audioActivationHandler: null,
  hydrate: () => {
    if (typeof localStorage === "undefined" || get().hydrated) return;

    let volume = DEFAULT_VOLUME;
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "{}",
      ) as Partial<MusicPlayerPreferences>;
      volume = clampVolume(saved.volume ?? DEFAULT_VOLUME);
    } catch {
      // Invalid optional state falls back to safe defaults.
    }
    set({ volume, hydrated: true });
  },
  setVolume: (value) => {
    const volume = clampVolume(value);
    set({ volume });
    save({ volume });
  },
  setActivated: (activated) => set({ activated, activationRequested: false }),
  setPlayerReady: (playerReady) => set({ playerReady }),
  setPlaybackProgress: (currentTime, duration) => set({
    currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
  }),
  requestAudioActivation: () => {
    const activated = get().audioActivationHandler?.() ?? false;
    if (activated) {
      set({ activated: true, activationRequested: false });
    } else {
      set({ activationRequested: true });
    }
    return activated;
  },
  setAudioActivationHandler: (audioActivationHandler) => set({ audioActivationHandler }),
  resetPlayback: () => set({
    activated: false,
    activationRequested: false,
    playerReady: false,
    currentTime: 0,
    duration: 0,
    audioActivationHandler: null,
  }),
}));
