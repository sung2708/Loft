import { describe, expect, it } from "vitest";
import { translateUI } from "./uiText";

describe("UI localization", () => {
  it("translates guest invite and room actions into Vietnamese", () => {
    expect(translateUI("vi", "Room not found")).toBe("Không tìm thấy phòng");
    expect(translateUI("vi", "This room does not allow guests")).toBe("Phòng này không cho phép khách vào");
    expect(translateUI("vi", "Room chat")).toBe("Trò chuyện trong phòng");
    expect(translateUI("vi", "Music volume")).toBe("Âm lượng nhạc");
  });

  it("preserves English and user-generated text", () => {
    expect(translateUI("en", "Room chat")).toBe("Room chat");
    expect(translateUI("vi", "My custom room name")).toBe("My custom room name");
  });
});
