"use client";

import { create } from "zustand";
import { StageMode, DrawerType, ThemeMode } from "@/types/room";

interface UIState {
  theme: ThemeMode;
  stageMode: StageMode;
  activeDrawer: DrawerType;
  screenZoom: "fit" | "original";
  isDevicePickerOpen: boolean;
  isLeaveModalOpen: boolean;
  isFocusMode: boolean;

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
}

export const useUIStore = create<UIState>((set) => ({
  theme: "dark",
  stageMode: "stage",
  activeDrawer: null,
  screenZoom: "fit",
  isDevicePickerOpen: false,
  isLeaveModalOpen: false,
  isFocusMode: false,

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
}));
