import type { ApiRoom, RoomAppearance } from "@/types/api";

export const defaultRoomAppearance: RoomAppearance = {
  atmosphere: "ambient",
  accent: "blue",
  adaptive_media_background: true,
  version: 1,
};

export function roomWithAppearance(overrides: Partial<ApiRoom> = {}): ApiRoom {
  return {
    id: "room-1",
    slug: "ABC123",
    name: "Test room",
    owner_id: "owner-1",
    allow_guests: true,
    max_participants: 12,
    is_locked: false,
    password_required: false,
    created_at: "2026-09-15T00:00:00Z",
    ...defaultRoomAppearance,
    ...overrides,
  };
}
