"use client";

import { create } from "zustand";
import type { ApiMessage, ApiMessageReply } from "@/types/api";

const MAX_MESSAGES = 200;
/** Typing indicators expire unless refreshed (senders refresh every ~3s). */
export const TYPING_TTL_MS = 6000;

export interface TypingEntry {
  name: string;
  until: number;
}

interface ChatState {
  messages: ApiMessage[];
  unreadCount: number;
  sendError: string | null;
  /** Keyed by connection id; ephemeral, never persisted. */
  typing: Record<string, TypingEntry>;
  replace: (messages: ApiMessage[]) => void;
  append: (message: ApiMessage, isOpen: boolean) => void;
  update: (message: ApiMessage) => void;
  setTyping: (connectionId: string, name: string, now?: number) => void;
  pruneTyping: (now?: number) => void;
  clearUnread: () => void;
  setSendError: (message: string | null) => void;
  reset: () => void;
}

/** Names currently typing, excluding expired entries. */
export function activeTypers(
  typing: Record<string, TypingEntry>,
  now = Date.now(),
): string[] {
  return Object.values(typing)
    .filter((entry) => entry.until > now)
    .map((entry) => entry.name);
}

// Revisions come from PostgreSQL; delivery order across nodes is not authoritative.
function mergeMessages(
  previous: ApiMessage[],
  incoming: ApiMessage[],
): ApiMessage[] {
  const messages = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    const current = messages.get(message.id);
    if (
      !current ||
      (!current.deleted && (message.revision ?? 0) >= (current.revision ?? 0))
    )
      messages.set(message.id, message);
  }
  const parents = new Map<string, ApiMessageReply>();
  const remember = (parent: ApiMessageReply) => {
    const current = parents.get(parent.id);
    if (
      !current ||
      (!current.deleted && (parent.revision ?? 0) >= (current.revision ?? 0))
    )
      parents.set(parent.id, parent);
  };
  for (const message of messages.values()) {
    if (message.reply_to) remember(message.reply_to);
  }
  for (const message of messages.values()) {
    remember({
      id: message.id,
      sender_display_name: message.sender_display_name,
      revision: message.revision,
      deleted: message.deleted,
      content: message.deleted
        ? ""
        : Array.from(message.content).slice(0, 140).join(""),
    });
  }
  return [...messages.values()]
    .map((message) =>
      message.reply_to
        ? {
            ...message,
            reply_to: parents.get(message.reply_to.id) ?? message.reply_to,
          }
        : message,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-MAX_MESSAGES);
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  unreadCount: 0,
  sendError: null,
  typing: {},
  replace: (messages) => set({ messages: mergeMessages([], messages) }),
  append: (message, isOpen) =>
    set((state) => ({
      messages: mergeMessages(state.messages, [message]),
      unreadCount:
        isOpen || state.messages.some((item) => item.id === message.id)
          ? state.unreadCount
          : state.unreadCount + 1,
      typing: Object.fromEntries(
        Object.entries(state.typing).filter(
          ([, entry]) => entry.name !== message.sender_display_name,
        ),
      ),
    })),
  update: (message) =>
    set((state) => ({ messages: mergeMessages(state.messages, [message]) })),
  setTyping: (connectionId, name, now = Date.now()) =>
    set((state) => ({
      typing: {
        ...state.typing,
        [connectionId]: { name, until: now + TYPING_TTL_MS },
      },
    })),
  pruneTyping: (now = Date.now()) =>
    set((state) => {
      const live = Object.entries(state.typing).filter(
        ([, entry]) => entry.until > now,
      );
      return live.length === Object.keys(state.typing).length
        ? state
        : { typing: Object.fromEntries(live) };
    }),
  clearUnread: () => set({ unreadCount: 0 }),
  setSendError: (sendError) => set({ sendError }),
  reset: () =>
    set({ messages: [], unreadCount: 0, sendError: null, typing: {} }),
}));
