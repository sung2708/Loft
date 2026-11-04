import { beforeEach, expect, it } from "vitest";
import { useChatStore } from "./useChatStore";
import type { ApiMessage } from "@/types/api";
const message = (id: number): ApiMessage => ({
  id: String(id),
  room_id: "room",
  sender_id: "user",
  sender_type: "user",
  sender_display_name: "User",
  content: String(id),
  created_at: "2026-11-04T00:00:00Z",
});
beforeEach(() => useChatStore.getState().reset());
it("keeps the newest 200 messages and ignores duplicate delivery", () => {
  for (let i = 0; i < 1000; i++)
    useChatStore.getState().append(message(i), false);
  useChatStore.getState().append(message(999), false);
  expect(useChatStore.getState().messages).toHaveLength(200);
  expect(useChatStore.getState().messages[0].id).toBe("800");
  expect(useChatStore.getState().unreadCount).toBe(1000);
});
it("bounds and deduplicates snapshots and resets between rooms", () => {
  const messages = Array.from({ length: 300 }, (_, i) => message(i));
  useChatStore.getState().replace([...messages, message(299)]);
  expect(useChatStore.getState().messages).toHaveLength(200);
  expect(useChatStore.getState().messages[0].id).toBe("100");
  useChatStore.getState().reset();
  expect(useChatStore.getState().messages).toEqual([]);
});
