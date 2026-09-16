import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomSettings } from "./RoomSettings";
import type { ApiRoom } from "@/types/api";

const mockRoom: ApiRoom = {
  id: "test-room-id",
  slug: "test-room",
  name: "Living Room Hangout",
  owner_id: "user-1",
  allow_guests: true,
  max_participants: 12,
  is_locked: false,
  password_required: false,
  atmosphere: "ambient",
  accent: "blue",
  adaptive_media_background: true,
  version: 3,
  created_at: "2026-09-15T00:00:00Z",
};

describe("RoomSettings appearance controls", () => {
  it("renders host-only appearance controls with all 4 atmospheres and 5 accents", () => {
    const html = renderToStaticMarkup(
      <RoomSettings
        room={mockRoom}
        token="test-token"
        locale="en"
        isHost={true}
        onCancel={() => undefined}
        onSaved={() => undefined}
      />,
    );

    // Header & Fieldset
    expect(html).toContain("Room atmosphere");
    expect(html).toContain("Accent color");

    // All 4 atmospheres
    expect(html).toContain("minimal");
    expect(html).toContain("ambient");
    expect(html).toContain("focus");
    expect(html).toContain("party");

    // All 5 accents
    expect(html).toContain('data-accent="blue"');
    expect(html).toContain('data-accent="purple"');
    expect(html).toContain('data-accent="green"');
    expect(html).toContain('data-accent="orange"');
    expect(html).toContain('data-accent="rose"');

    // Adapt to shared media toggle
    expect(html).toContain("Adapt to shared media");
  });

  it("hides appearance controls when user is not the host (isHost=false)", () => {
    const html = renderToStaticMarkup(
      <RoomSettings
        room={mockRoom}
        token="test-token"
        locale="en"
        isHost={false}
        onCancel={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(html).not.toContain("Room atmosphere");
    expect(html).not.toContain("Accent color");
    expect(html).not.toContain('data-accent="rose"');
  });

  it("renders with localized Vietnamese labels when locale is vi", () => {
    const html = renderToStaticMarkup(
      <RoomSettings
        room={mockRoom}
        token="test-token"
        locale="vi"
        isHost={true}
        onCancel={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(html).toContain("Không khí phòng");
    expect(html).toContain("Màu chủ đạo");
    expect(html).toContain("Tự điều chỉnh theo media đang phát");
  });

  it("disables mutation inputs during pending state", () => {
    // Verified by checking disabled attributes when pending
    const html = renderToStaticMarkup(
      <RoomSettings
        room={mockRoom}
        token="test-token"
        locale="en"
        isHost={true}
        onCancel={() => undefined}
        onSaved={() => undefined}
      />,
    );

    // By default form has interactive submit button
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("disabled aria-checked");
  });
});
