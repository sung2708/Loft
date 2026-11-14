import { describe, expect, it } from "vitest";
import { attentionTitle, newMessages } from "./useTabSignals";

describe("attentionTitle", () => {
  it("prefixes the pending count and caps it", () => {
    expect(attentionTitle("Room · Mingly", 0, 0)).toBe("Room · Mingly");
    expect(attentionTitle("Room · Mingly", 2, 1)).toBe("(3) Room · Mingly");
    expect(attentionTitle("Room", 150, 0)).toBe("(99+) Room");
  });
});

it("finds the new message when a full chat buffer drops its oldest message", () => {
  const previous = Array.from({ length: 200 }, (_, index) => ({ id: String(index) }));
  const incoming = { id: "200" };
  expect(newMessages([...previous.slice(1), incoming], previous)).toEqual([incoming]);
});
