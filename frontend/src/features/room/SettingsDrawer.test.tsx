import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsDrawer } from "./SettingsDrawer";
import { useRoomStore } from "@/stores/useRoomStore";
import { useI18nStore } from "@/lib/i18n/useTranslation";
import type { RoomSnapshot } from "@/types/api";

const mockSnapshot: RoomSnapshot = {
  room: {
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
  },
  host: {
    connection_id: "conn-1",
    identity_id: "user-1",
    identity_type: "user",
    generation: 1,
    version: 1,
    state: "connected",
  },
  self: {
    connection_id: "conn-1",
    identity_id: "user-1",
    identity_type: "user",
    display_name: "Host User",
    role: "host",
    livekit_identity: "user:user-1",
    joined_at: "2026-09-15T00:00:00Z",
  },
  participants: [],
  messages: [],
};

describe("SettingsDrawer", () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    useRoomStore.getState().applySnapshot(mockSnapshot);
    useI18nStore.getState().setLocale("vi");
  });

  it("renders room name, guest access, password, and atmosphere controls for host", () => {
    const html = renderToStaticMarkup(<SettingsDrawer />);

    expect(html).toContain("Cài đặt phòng");
    expect(html).toContain("Thông tin chung");
    expect(html).toContain("Tên phòng");
    expect(html).toContain("Living Room Hangout");
    expect(html).toContain("Cho phép khách vào");
    expect(html).toContain("Bảo mật &amp; Quyền vào");
    expect(html).toContain("Yêu cầu mật khẩu");
    expect(html).toContain("Khóa phòng với người mới");
    expect(html).toContain("Không khí phòng");
    expect(html).toContain("minimal");
    expect(html).toContain("ambient");
    expect(html).toContain("focus");
    expect(html).toContain("party");
    expect(html).toContain("Âm thanh");
  });

  it("hides atmosphere controls when self is not host", () => {
    useRoomStore.getState().applySnapshot({
      ...mockSnapshot,
      self: {
        ...mockSnapshot.self!,
        role: "member",
      },
    });

    const html = renderToStaticMarkup(<SettingsDrawer />);

    expect(html).toContain("Cài đặt phòng");
    expect(html).toContain("Tên phòng");
    expect(html).not.toContain("Không khí phòng");
  });

  it("renders with English labels when locale is en", () => {
    useI18nStore.getState().setLocale("en");
    const html = renderToStaticMarkup(<SettingsDrawer />);

    expect(html).toContain("Room settings");
    expect(html).toContain("General");
    expect(html).toContain("Room name");
    expect(html).toContain("Allow guests");
    expect(html).toContain("Require password");
    expect(html).toContain("Audio &amp; SFX");
  });
});
