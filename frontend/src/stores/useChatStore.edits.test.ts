import { beforeEach, describe, expect, it } from "vitest";
import { activeTypers, TYPING_TTL_MS, useChatStore } from "./useChatStore";
import type { ApiMessage } from "@/types/api";

const message = (id: string, extra: Partial<ApiMessage> = {}): ApiMessage => ({
  id,
  room_id: "room",
  sender_id: "u1",
  sender_type: "guest",
  sender_display_name: "An",
  content: `text ${id}`,
  created_at: "2026-11-13T00:00:00Z",
  ...extra,
});

describe("useChatStore", () => {
  beforeEach(() => useChatStore.getState().reset());

  it("replaces an edited message and refreshes quotes of it", () => {
    const store = useChatStore.getState();
    store.append(message("a"), true);
    store.append(
      message("b", {
        reply_to: { id: "a", sender_display_name: "An", content: "text a" },
      }),
      true,
    );
    useChatStore
      .getState()
      .update(message("a", { content: "changed", edited_at: "x" }));
    const [first, second] = useChatStore.getState().messages;
    expect(first.content).toBe("changed");
    expect(second.reply_to?.content).toBe("changed");

    useChatStore
      .getState()
      .update(message("a", { content: "", deleted: true }));
    expect(useChatStore.getState().messages[1].reply_to).toMatchObject({
      content: "",
      deleted: true,
    });
  });

  it("expires typing entries and clears them when the sender posts", () => {
    const store = useChatStore.getState();
    store.setTyping("c1", "An", 1000);
    store.setTyping("c2", "Binh", 1000);
    expect(activeTypers(useChatStore.getState().typing, 1001).sort()).toEqual([
      "An",
      "Binh",
    ]);
    expect(
      activeTypers(useChatStore.getState().typing, 1000 + TYPING_TTL_MS),
    ).toEqual([]);

    useChatStore.getState().append(message("m"), true);
    expect(
      Object.values(useChatStore.getState().typing).map((e) => e.name),
    ).toEqual(["Binh"]);

    useChatStore.getState().pruneTyping(1000 + TYPING_TTL_MS + 1);
    expect(useChatStore.getState().typing).toEqual({});
  });
});

it("keeps deletion when an earlier edit arrives last, including quotes", () => {
  useChatStore.getState().reset();
  const original = message("a", { revision: 0 });
  const edited = { ...original, content: "edited", revision: 1 };
  const deleted = { ...original, content: "", deleted: true, revision: 2 };
  useChatStore.getState().append(original, true);
  useChatStore.getState().update(deleted);
  useChatStore.getState().update(edited);
  useChatStore.getState().append(
    message("b", {
      reply_to: {
        id: "a",
        content: "old quote",
        sender_display_name: "An",
        revision: 0,
      },
    }),
    true,
  );
  expect(useChatStore.getState().messages[0]).toMatchObject(deleted);
  expect(useChatStore.getState().messages[1].reply_to).toMatchObject({
    deleted: true,
    content: "",
    revision: 2,
  });
});

it("keeps the newest edit even when the original message arrives last", () => {
  useChatStore.getState().reset();
  useChatStore
    .getState()
    .update(message("a", { content: "latest", revision: 2 }));
  useChatStore
    .getState()
    .update(message("a", { content: "older", revision: 1 }));
  useChatStore.getState().append(message("a", { revision: 0 }), true);
  expect(useChatStore.getState().messages).toHaveLength(1);
  expect(useChatStore.getState().messages[0].content).toBe("latest");
});
