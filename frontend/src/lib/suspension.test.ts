import { describe, expect, it } from "vitest";
import { suspensionMessage } from "./suspension";

describe("suspensionMessage", () => {
  it("states the reason and end date without the admin note", () => {
    const message = suspensionMessage(
      { reason: "spam", expires_at: "2026-12-01T10:00:00Z" },
      "en",
    );
    expect(message).toContain("spam or scams");
    expect(message).toContain("2026");
  });
  it("covers permanent and unknown suspensions in Vietnamese", () => {
    expect(
      suspensionMessage({ reason: "safety", expires_at: null }, "vi"),
    ).toBe("Tài khoản này bị khóa vì đe dọa hoặc quấy rối.");
    expect(suspensionMessage(undefined, "vi")).toBe(
      "Tài khoản này đang bị tạm khóa.",
    );
  });
});
