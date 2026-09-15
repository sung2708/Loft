"use client";

import { create } from "zustand";
import { DEFAULT_RUNTIME, DEFAULT_SELECTION, type AREffect, type BackgroundEffect, type EffectSelection, type LookEffect, type ProcessorRuntime } from "@/features/room/effects/contracts";

interface VideoEffectsState {
  selection: EffectSelection;
  runtime: ProcessorRuntime;
  panelOpen: boolean;
  setBackground: (background: BackgroundEffect, customBackgroundId?: string) => void;
  setLook: (look: LookEffect) => void;
  setAR: (ar: AREffect) => void;
  setRuntime: (runtime: Partial<ProcessorRuntime>) => void;
  setPanelOpen: (open: boolean) => void;
  resetRuntime: () => void;
  reset: () => void;
}

const bump = (selection: EffectSelection, patch: Partial<EffectSelection>): EffectSelection => ({
  ...selection,
  ...patch,
  generation: selection.generation + 1,
});

export const useVideoEffectsStore = create<VideoEffectsState>((set) => ({
  selection: DEFAULT_SELECTION,
  runtime: DEFAULT_RUNTIME,
  panelOpen: false,
  setBackground: (background, customBackgroundId) => set((state) => ({
    selection: bump(state.selection, { background, customBackgroundId: background === "custom" ? customBackgroundId : undefined }),
  })),
  setLook: (look) => set((state) => ({ selection: bump(state.selection, { look }) })),
  setAR: (ar) => set((state) => ({ selection: bump(state.selection, { ar }) })),
  setRuntime: (runtime) => set((state) => ({ runtime: { ...state.runtime, ...runtime } })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  resetRuntime: () => set({ runtime: DEFAULT_RUNTIME }),
  reset: () => set({ selection: DEFAULT_SELECTION, runtime: DEFAULT_RUNTIME, panelOpen: false }),
}));
