"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/useChatStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { translateUI } from "@/lib/i18n/uiText";
import { useI18nStore } from "@/lib/i18n/useTranslation";

/** Title shown while the tab is hidden and something needs attention. */
export function attentionTitle(base: string, unread: number, joinRequests: number): string {
  const total = unread + joinRequests;
  return total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
}

export function newMessages<T extends { id: string }>(current: T[], previous: T[]): T[] {
  const known = new Set(previous.map(({ id }) => id));
  return current.filter(({ id }) => !known.has(id));
}

export function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

const tr = (english: string) => translateUI(useI18nStore.getState().locale, english);

/**
 * While the room tab is in the background, count new messages from others
 * (and join requests for the host) in the tab title, and raise a system
 * notification for join requests when the host allowed notifications.
 */
export function useTabSignals(isHost: boolean) {
  const hidden = useRef(false);
  const counts = useRef({ unread: 0, joins: 0 });
  const baseTitle = useRef<string | null>(null);
  const hostRef = useRef(isHost);
  useEffect(() => {
    hostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const render = () => {
      if (!hidden.current || baseTitle.current === null) return;
      document.title = attentionTitle(baseTitle.current, counts.current.unread, counts.current.joins);
    };
    const onVisibility = () => {
      if (document.hidden) {
        hidden.current = true;
        baseTitle.current = document.title;
        counts.current = { unread: 0, joins: 0 };
      } else {
        hidden.current = false;
        if (baseTitle.current !== null) document.title = baseTitle.current;
        baseTitle.current = null;
      }
    };
    onVisibility();

    const unsubscribeChat = useChatStore.subscribe((state, previous) => {
      if (!hidden.current || state.messages === previous.messages) return;
      const self = useRoomStore.getState().self;
      const fresh = newMessages(state.messages, previous.messages).filter(
        (message) =>
          message.sender_id !== "system" &&
          message.sender_id !== "" &&
          !(self && message.sender_id === self.identity_id && message.sender_type === self.identity_type),
      );
      if (fresh.length === 0) return;
      counts.current.unread += fresh.length;
      render();
    });

    const unsubscribeRoom = useRoomStore.subscribe((state, previous) => {
      if (state.joinRequestsCreated <= previous.joinRequestsCreated || !hostRef.current) return;
      if (!hidden.current) return;
      counts.current.joins += 1;
      render();
      if (canNotify() && Notification.permission === "granted") {
        try {
          const notification = new Notification(tr("Someone wants to join"), {
            body: state.room?.name ?? "Mingly",
            tag: `join-requests-${state.room?.id ?? ""}`,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } catch {
          // Some platforms (e.g. Android Chrome) only allow service-worker notifications.
        }
      }
    });

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeChat();
      unsubscribeRoom();
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, []);
}
