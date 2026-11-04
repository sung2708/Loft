"use client";

import { create } from "zustand";
import type { ApiMessage } from "@/types/api";

const MAX_MESSAGES = 200;

interface ChatState {
  messages: ApiMessage[];
  unreadCount: number;
  sendError: string | null;
  replace: (messages: ApiMessage[]) => void;
  append: (message: ApiMessage, isOpen: boolean) => void;
  clearUnread: () => void;
  setSendError: (message: string | null) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  unreadCount: 0,
  sendError: null,
  replace: (messages) =>
    set({
      messages: [
        ...new Map(messages.map((item) => [item.id, item])).values(),
      ].slice(-MAX_MESSAGES),
    }),
  append: (message, isOpen) =>
    set((state) =>
      state.messages.some((item) => item.id === message.id)
        ? state
        : {
            messages: [...state.messages.slice(-(MAX_MESSAGES - 1)), message],
            unreadCount: isOpen ? state.unreadCount : state.unreadCount + 1,
          },
    ),
  clearUnread: () => set({ unreadCount: 0 }),
  setSendError: (sendError) => set({ sendError }),
  reset: () => set({ messages: [], unreadCount: 0, sendError: null }),
}));
