"use client";

import { create } from "zustand";
import type { SpotifyConnectionState, SpotifyRoomVisibility } from "@/lib/spotify/types";
import { API_URL } from "@/lib/config";

interface SpotifyState {
  connection: SpotifyConnectionState;
  roomVisibility: Record<string, SpotifyRoomVisibility>;
  isLoading: boolean;
  error: string | null;
  setConnection: (connection: SpotifyConnectionState) => void;
  setRoomVisibility: (visibility: SpotifyRoomVisibility) => void;
  clearRoomVisibility: (roomId: string) => void;
  fetchStatus: (token?: string) => Promise<SpotifyConnectionState>;
  disconnect: (token?: string) => Promise<boolean>;
  reset: () => void;
}

const disconnected: SpotifyConnectionState = {
  status: "DISCONNECTED",
  scopes: [],
  playback: "UNKNOWN",
};

export const useSpotifyStore = create<SpotifyState>((set, get) => ({
  connection: disconnected,
  roomVisibility: {},
  isLoading: false,
  error: null,
  setConnection: (connection) => set({ connection }),
  setRoomVisibility: (visibility) =>
    set((state) => ({
      roomVisibility: { ...state.roomVisibility, [visibility.roomId]: visibility },
    })),
  clearRoomVisibility: (roomId) =>
    set((state) => {
      const next = { ...state.roomVisibility };
      delete next[roomId];
      return { roomVisibility: next };
    }),
  fetchStatus: async (token?: string) => {
    if (!token) {
      set({ connection: disconnected, isLoading: false, error: null });
      return disconnected;
    }
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/api/v1/spotify/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        if (res.status === 401) {
          set({ connection: disconnected, isLoading: false });
          return disconnected;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const connectionState: SpotifyConnectionState = {
        status: data.status || (data.connected ? "CONNECTED" : "DISCONNECTED"),
        scopes: data.scopes || [],
        playback: data.playback || "UNKNOWN",
        connectedAt: data.connected_at,
        product: data.product,
      };
      set({ connection: connectionState, isLoading: false, error: null });
      return connectionState;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch status";
      set({ isLoading: false, error: message });
      return get().connection;
    }
  },
  disconnect: async (token?: string) => {
    if (!token) return false;
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/api/v1/spotify/disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ connection: disconnected, isLoading: false, error: null });
        return true;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to disconnect";
      set({ isLoading: false, error: message });
      return false;
    }
  },
  reset: () => set({ connection: disconnected, roomVisibility: {}, isLoading: false, error: null }),
}));
