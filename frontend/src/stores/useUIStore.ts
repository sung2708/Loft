"use client";

import { create } from "zustand";
import { StageMode, DrawerType, ThemeMode } from "@/types/room";
import type { RoomAccent, RoomAtmosphere } from "@/types/api";

export interface RoomAppearancePreview {
  atmosphere: RoomAtmosphere;
  accent: RoomAccent;
  adaptiveMediaBackground: boolean;
}

interface UIState {
  theme: ThemeMode;
  stageMode: StageMode;
  activeDrawer: DrawerType;
  screenZoom: "fit" | "original";
  isDevicePickerOpen: boolean;
  isLeaveModalOpen: boolean;
  isFocusMode: boolean;
  /** Local-only draft while a host previews a shared room appearance. */
  roomAppearancePreview: RoomAppearancePreview | null;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setStageMode: (mode: StageMode) => void;
  toggleDrawer: (drawer: DrawerType) => void;
  closeDrawer: () => void;
  setScreenZoom: (zoom: "fit" | "original") => void;
  setDevicePickerOpen: (open: boolean) => void;
  setLeaveModalOpen: (open: boolean) => void;
  setIsFocusMode: (isFocusMode: boolean) => void;
  toggleFocusMode: () => void;
  setRoomAppearancePreview: (preview: RoomAppearancePreview) => void;
  clearRoomAppearancePreview: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  stageMode: "stage",
  activeDrawer: null,
  screenZoom: "fit",
  isDevicePickerOpen: false,
  isLeaveModalOpen: false,
  isFocusMode: false,
  roomAppearancePreview: null,

  setTheme: (theme) => set({ theme }),

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") {
        document.documentElement.classList.remove("dark", "light");
        document.documentElement.classList.add(next);
      }
      return { theme: next };
    }),

  setStageMode: (stageMode) => set({ stageMode }),

  toggleDrawer: (drawer) =>
    set((state) => ({
      activeDrawer: state.activeDrawer === drawer ? null : drawer,
    })),

  closeDrawer: () => set({ activeDrawer: null }),

  setScreenZoom: (screenZoom) => set({ screenZoom }),

  setDevicePickerOpen: (isDevicePickerOpen) => set({ isDevicePickerOpen }),

  setLeaveModalOpen: (isLeaveModalOpen) => set({ isLeaveModalOpen }),

  setIsFocusMode: (isFocusMode) => set({ isFocusMode }),

  toggleFocusMode: () => set((state) => ({ isFocusMode: !state.isFocusMode })),

  setRoomAppearancePreview: (roomAppearancePreview) => set({ roomAppearancePreview }),

  clearRoomAppearancePreview: () => set({ roomAppearancePreview: null }),
}));
