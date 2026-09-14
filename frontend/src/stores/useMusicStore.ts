"use client";

import { create } from "zustand";
import type { RoomMediaState } from "@/types/api";

interface MusicState {
  media: RoomMediaState;
  available: boolean;
  error: string | null;
  clockOffsetMs: number;
  setMedia: (media: unknown) => void;
  replaceMedia: (media: unknown) => void;
  setError: (error: string | null) => void;
  setClockOffset: (offset: number) => void;
  reset: () => void;
}

export const emptyMedia: RoomMediaState = {
  current: null,
  queue: [],
  repeat: false,
  status: "IDLE",
  position_ms: 0,
  started_at: "",
  version: 0,
};

function validTrack(value: unknown): value is NonNullable<RoomMediaState["current"]> {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return typeof track.id === "string" && typeof track.video_id === "string" && typeof track.added_by === "string";
}

export function parseRoomMedia(value: unknown): RoomMediaState | null {
  if (!value || typeof value !== "object") return null;
  const media = value as Record<string, unknown>;
  if (
    (media.status !== "IDLE" && media.status !== "PAUSED" && media.status !== "PLAYING") ||
    typeof media.repeat !== "boolean" ||
    !Number.isSafeInteger(media.version) || Number(media.version) < 0 ||
    typeof media.position_ms !== "number" || !Number.isFinite(media.position_ms) || media.position_ms < 0 ||
    typeof media.started_at !== "string" ||
    !Array.isArray(media.queue) || media.queue.length > 50 || !media.queue.every(validTrack) ||
    (media.current !== null && !validTrack(media.current))
  ) return null;
  return media as unknown as RoomMediaState;
}

export const useMusicStore = create<MusicState>((set) => ({
  media: emptyMedia,
  available: false,
  error: null,
  clockOffsetMs: 0,
  setMedia: (value) => set((state) => {
    const media = parseRoomMedia(value);
    if (!media) return { error: "Invalid media state from server." };
    return media.version < (state.media?.version ?? 0) ? state : { media, available: true, error: null };
  }),
  replaceMedia: (value) => set(() => {
    const media = parseRoomMedia(value);
    return media
      ? { media, available: true, error: null }
      : { media: emptyMedia, available: false, error: "Restart the Go server to enable YouTube Lounge." };
  }),
  setError: (error) => set({ error }),
  setClockOffset: (clockOffsetMs) => set({ clockOffsetMs }),
  reset: () => set({ media: emptyMedia, available: false, error: null, clockOffsetMs: 0 }),
}));
