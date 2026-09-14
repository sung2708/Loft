export type NormalizedRoomInput =
  { type: "room_id"; value: string } | { type: "invite"; value: string };

const identifierPattern = /^[a-zA-Z0-9-]{3,64}$/;

export function normalizeRoomInput(input: string): NormalizedRoomInput | null {
  const value = input.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 2 ||
      (parts[0] !== "join" && parts[0] !== "room") ||
      !identifierPattern.test(parts[1])
    )
      return null;
    return { type: "invite", value: parts[1].toLowerCase() };
  } catch {
    if (!identifierPattern.test(value)) return null;
    return {
      type: value.includes("-") ? "room_id" : "invite",
      value: value.toLowerCase(),
    };
  }
}
