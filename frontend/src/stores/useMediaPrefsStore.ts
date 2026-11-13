"use client";

import { create } from "zustand";

/**
 * Local-only media preferences (UI state, never authoritative).
 * Device ids and push-to-talk survive reloads; they never leave the browser.
 */
const STORAGE_KEY = "mingly.media.preferences";

export interface MediaPreferences {
  audioDeviceId: string;
  videoDeviceId: string;
  /** Last pre-join choice, used as the next pre-join default. */
  micOnJoin: boolean;
  cameraOnJoin: boolean;
  pushToTalk: boolean;
  /** "detail" keeps text sharp (slides, code); "motion" keeps video smooth. */
  screenShareMode: ScreenShareMode;
}

export type ScreenShareMode = "detail" | "motion";

interface MediaPrefsState extends MediaPreferences {
  hydrated: boolean;
  hydrate: () => void;
  update: (patch: Partial<MediaPreferences>) => void;
}

export const defaultMediaPreferences: MediaPreferences = {
  audioDeviceId: "",
  videoDeviceId: "",
  micOnJoin: true,
  cameraOnJoin: false,
  pushToTalk: false,
  screenShareMode: "detail",
};

export function parseMediaPreferences(raw: string | null): MediaPreferences {
  try {
    const value = JSON.parse(raw ?? "{}") as Partial<MediaPreferences>;
    const text = (input: unknown) =>
      typeof input === "string" && input.length <= 256 ? input : "";
    const flag = (input: unknown, fallback: boolean) =>
      typeof input === "boolean" ? input : fallback;
    return {
      audioDeviceId: text(value.audioDeviceId),
      videoDeviceId: text(value.videoDeviceId),
      micOnJoin: flag(value.micOnJoin, defaultMediaPreferences.micOnJoin),
      cameraOnJoin: flag(value.cameraOnJoin, defaultMediaPreferences.cameraOnJoin),
      pushToTalk: flag(value.pushToTalk, defaultMediaPreferences.pushToTalk),
      screenShareMode: value.screenShareMode === "motion" ? "motion" : "detail",
    };
  } catch {
    return defaultMediaPreferences;
  }
}

function save(preferences: MediaPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
  } catch {
    // Preferences are optional; storage failure must not affect a room.
  }
}

const pick = (state: MediaPreferences): MediaPreferences => ({
  audioDeviceId: state.audioDeviceId,
  videoDeviceId: state.videoDeviceId,
  micOnJoin: state.micOnJoin,
  cameraOnJoin: state.cameraOnJoin,
  pushToTalk: state.pushToTalk,
  screenShareMode: state.screenShareMode,
});

export const useMediaPrefsStore = create<MediaPrefsState>((set, get) => ({
  ...defaultMediaPreferences,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Blocked storage falls back to defaults.
    }
    set({ ...parseMediaPreferences(raw), hydrated: true });
  },
  update: (patch) => {
    set(patch);
    save(pick(get()));
  },
}));
