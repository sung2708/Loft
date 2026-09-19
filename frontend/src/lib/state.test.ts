import { describe, expect, it } from "vitest";
import { safeAuthDestination } from "./authRedirect";
import { reconnectDelay } from "./realtime";
import { normalizeRoomInput } from "./roomInput";

describe("safeAuthDestination", () => {
  it("keeps internal intended routes", () => {
    expect(safeAuthDestination("/")).toBe("/");
    expect(safeAuthDestination("/settings")).toBe("/settings");
    expect(safeAuthDestination("/room/late-night")).toBe("/room/late-night");
    expect(safeAuthDestination("/home?create=1")).toBe("/home?create=1");
  });

  it("rejects external and protocol-relative redirects, defaulting to root", () => {
    expect(safeAuthDestination("https://evil.example")).toBe("/");
    expect(safeAuthDestination("//evil.example")).toBe("/");
    expect(safeAuthDestination("/\\evil.example")).toBe("/");
    expect(safeAuthDestination("/room/a:b")).toBe("/");
    expect(safeAuthDestination(null)).toBe("/");
    expect(safeAuthDestination(undefined)).toBe("/");
  });

  it("rejects auth callback routes to prevent redirect loops", () => {
    expect(safeAuthDestination("/auth/callback")).toBe("/");
    expect(safeAuthDestination("/auth/callback?code=123")).toBe("/");
  });

  it("supports custom fallback destination", () => {
    expect(safeAuthDestination("https://evil.example", "/custom")).toBe("/custom");
  });
});

describe("normalizeRoomInput", () => {
  it("normalizes room IDs, invite codes, and invite URLs", () => {
    expect(normalizeRoomInput("late-night")).toEqual({
      type: "room_id",
      value: "late-night",
    });
    expect(normalizeRoomInput(" ABCD1234 ")).toEqual({
      type: "invite",
      value: "abcd1234",
    });
    expect(normalizeRoomInput("https://loft.app/join/ABCD1234")).toEqual({
      type: "invite",
      value: "abcd1234",
    });
    expect(normalizeRoomInput(" 012345 ")).toEqual({
      type: "invite",
      value: "012345",
    });
  });

  it("rejects malformed and unrelated URLs", () => {
    expect(normalizeRoomInput("https://loft.app/home")).toBeNull();
    expect(normalizeRoomInput("javascript:alert(1)")).toBeNull();
    expect(normalizeRoomInput("a/b")).toBeNull();
  });
});

describe("reconnectDelay", () => {
  it("uses exponential backoff with bounded jitter", () => {
    expect(reconnectDelay(1, 0)).toBe(375);
    expect(reconnectDelay(2, 1)).toBe(1250);
    expect(reconnectDelay(20, 0.5)).toBe(15000);
  });
});
