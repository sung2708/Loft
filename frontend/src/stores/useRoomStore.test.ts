import { beforeEach, describe, expect, it } from "vitest";
import { useRoomStore } from "./useRoomStore";
import type { RoomSnapshot } from "@/types/api";

const snapshot: RoomSnapshot = {
  room: { id: "room", slug: "123456", name: "Room", owner_id: "owner", allow_guests: true, max_participants: 12, is_locked: false, password_required: false, atmosphere: "ambient", accent: "blue", adaptive_media_background: true, version: 1, created_at: "2026-09-15T00:00:00Z" },
  host: { connection_id: "conn", identity_id: "member", identity_type: "user", generation: 1, version: 1, state: "connected" },
  self: { connection_id: "conn", identity_id: "member", identity_type: "user", display_name: "Minh", role: "host", livekit_identity: "user:member", joined_at: "2026-09-15T00:00:00Z" },
  participants: [{ connection_id: "conn", identity_id: "member", identity_type: "user", display_name: "Minh", role: "host", livekit_identity: "user:member", joined_at: "2026-09-15T00:00:00Z" }],
  messages: [],
};

describe("room social state", () => {
  beforeEach(() => useRoomStore.getState().reset());

  it("defaults absent rolling-deployment fields safely", () => {
    useRoomStore.getState().applySnapshot(snapshot);
    expect(useRoomStore.getState().self).toMatchObject({ raised_hand: false, social_version: 0 });
  });

  it("applies only newer hand facts and removes state with participant", () => {
    useRoomStore.getState().applySnapshot(snapshot);
    useRoomStore.getState().handChanged("conn", true, 2);
    useRoomStore.getState().handChanged("conn", false, 1);
    expect(useRoomStore.getState().participants[0]).toMatchObject({ raised_hand: true, social_version: 2 });
    useRoomStore.getState().participantLeft("conn");
    expect(useRoomStore.getState().participants).toEqual([]);
  });

  it("applies only newer authoritative room appearance", () => {
    useRoomStore.getState().applySnapshot(snapshot);
    useRoomStore.getState().roomAppearanceUpdated({ atmosphere: "party", accent: "rose", adaptive_media_background: false, version: 2 });
    expect(useRoomStore.getState().room).toMatchObject({ atmosphere: "party", accent: "rose", version: 2 });
    useRoomStore.getState().roomAppearanceUpdated({ atmosphere: "minimal", accent: "green", adaptive_media_background: true, version: 1 });
    expect(useRoomStore.getState().room).toMatchObject({ atmosphere: "party", accent: "rose", version: 2 });
  });
});
