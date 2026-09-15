"use client";

import { create } from "zustand";

interface Reaction {
  displayName: string;
  emoji: string;
  count: number;
  expiresAt: number;
}

interface ReactionState {
  reactions: Reaction[];
  append: (reaction: Pick<Reaction, "emoji" | "displayName">) => void;
  appendWave: (displayName: string) => void;
  clearExpired: (now: number) => void;
  reset: () => void;
}

export const useReactionStore = create<ReactionState>((set) => ({
  reactions: [],
  append: (reaction) => set((state) => {
    const now = Date.now();
    const fresh = state.reactions.filter((item) => item.expiresAt > now);
    const existing = fresh.find((item) => item.emoji === reaction.emoji);
    if (existing) return { reactions: fresh.map((item) => item.emoji === reaction.emoji ? { ...item, count: Math.min(item.count + 1, 99), displayName: reaction.displayName, expiresAt: now + 2600 } : item) };
    return { reactions: [...fresh.slice(-5), { ...reaction, count: 1, expiresAt: now + 2600 }] };
  }),
  appendWave: (displayName) => set((state) => {
    const now = Date.now();
    const fresh = state.reactions.filter((item) => item.expiresAt > now);
    return { reactions: [...fresh.slice(-5), { emoji: "👋", displayName, count: 1, expiresAt: now + 2600 }] };
  }),
  clearExpired: (now) => set((state) => ({ reactions: state.reactions.filter((item) => item.expiresAt > now) })),
  reset: () => set({ reactions: [] }),
}));
