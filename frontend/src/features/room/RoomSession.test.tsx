import { beforeEach, describe, expect, it } from "vitest";
import { useRoomStore } from "@/stores/useRoomStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { useUIStore } from "@/stores/useUIStore";
import type { RoomSnapshot } from "@/types/api";

const baselineSnapshot: RoomSnapshot = {
  room: {
    id: "room-session-test",
    slug: "sess123",
    name: "Identity Test Room",
    owner_id: "owner-user",
    allow_guests: true,
    max_participants: 12,
    is_locked: false,
    password_required: false,
    atmosphere: "ambient",
    accent: "blue",
    adaptive_media_background: true,
    version: 1,
    created_at: "2026-09-15T00:00:00Z",
  },
  host: {
    connection_id: "host-conn",
    identity_id: "owner-user",
    identity_type: "user",
    generation: 1,
    version: 1,
    state: "connected",
  },
  self: {
    connection_id: "host-conn",
    identity_id: "owner-user",
    identity_type: "user",
    display_name: "Host User",
    role: "host",
    livekit_identity: "user:owner-user",
    joined_at: "2026-09-15T00:00:00Z",
  },
  participants: [
    {
      connection_id: "host-conn",
      identity_id: "owner-user",
      identity_type: "user",
      display_name: "Host User",
      role: "host",
      livekit_identity: "user:owner-user",
      joined_at: "2026-09-15T00:00:00Z",
    },
    {
      connection_id: "guest-conn",
      identity_id: "guest-1",
      identity_type: "guest",
      display_name: "Guest Bob",
      role: "guest",
      livekit_identity: "guest:guest-1",
      joined_at: "2026-09-15T00:00:01Z",
    },
  ],
  messages: [],
};

describe("RoomSession identity and media regression", () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    useMusicStore.getState().reset();
    useUIStore.setState({ activeDrawer: null });
  });

  it("atmosphere transitions preserve media playback authority and clock", () => {
    useRoomStore.getState().applySnapshot(baselineSnapshot);

    // Set up playing media state in useMusicStore
    useMusicStore.getState().setMedia({
      current: {
        id: "media-1",
        video_id: "dQw4w9WgXcQ",
        title: "Test Video",
        channel: "Test Channel",
        duration: 212,
        added_by: "Host User",
      },
      queue: [],
      repeat: false,
      status: "PLAYING",
      position_ms: 45500,
      started_at: "2026-09-15T00:00:00Z",
      version: 5,
    });

    const initialMedia = useMusicStore.getState().media;
    expect(initialMedia.status).toBe("PLAYING");
    expect(initialMedia.current?.video_id).toBe("dQw4w9WgXcQ");

    // Change atmosphere to Party + Rose
    useRoomStore.getState().roomAppearanceUpdated({
      atmosphere: "party",
      accent: "rose",
      adaptive_media_background: true,
      version: 2,
    });

    // Room appearance updated
    expect(useRoomStore.getState().room?.atmosphere).toBe("party");
    expect(useRoomStore.getState().room?.accent).toBe("rose");

    // Media state must remain completely untouched
    const afterMedia = useMusicStore.getState().media;
    expect(afterMedia.status).toBe("PLAYING");
    expect(afterMedia.current?.video_id).toBe("dQw4w9WgXcQ");
    expect(afterMedia.version).toBe(5);
    expect(afterMedia.position_ms).toBe(45500);
    expect(afterMedia.repeat).toBe(false);
  });

  it("atmosphere transitions preserve participant list, roles, and raised hand state", () => {
    useRoomStore.getState().applySnapshot(baselineSnapshot);
    useRoomStore.getState().handChanged("guest-conn", true, 1);

    expect(useRoomStore.getState().participants[1].raised_hand).toBe(true);

    // Host transitions atmosphere across all 4 modes
    for (const mode of ["minimal", "focus", "party", "ambient"] as const) {
      useRoomStore.getState().roomAppearanceUpdated({
        atmosphere: mode,
        accent: "green",
        adaptive_media_background: false,
        version: useRoomStore.getState().room!.version + 1,
      });

      // Participant identities, connections, and roles remain intact
      const parts = useRoomStore.getState().participants;
      expect(parts).toHaveLength(2);
      expect(parts[0].connection_id).toBe("host-conn");
      expect(parts[0].role).toBe("host");
      expect(parts[1].connection_id).toBe("guest-conn");
      expect(parts[1].role).toBe("guest");
      expect(parts[1].raised_hand).toBe(true);
    }
  });

  it("atmosphere transitions preserve drawer selection and UI layout state", () => {
    useRoomStore.getState().applySnapshot(baselineSnapshot);
    useUIStore.setState({ activeDrawer: "chat" });

    expect(useUIStore.getState().activeDrawer).toBe("chat");

    useRoomStore.getState().roomAppearanceUpdated({
      atmosphere: "party",
      accent: "purple",
      adaptive_media_background: true,
      version: 2,
    });

    expect(useUIStore.getState().activeDrawer).toBe("chat");
  });

  it("keeps the room-authoritative autoplay setting in the media snapshot", () => {
    useMusicStore.getState().setMedia({
      current: null,
      queue: [],
      repeat: false,
      autoplay: true,
      status: "IDLE",
      position_ms: 0,
      started_at: "",
      version: 6,
    });

    expect(useMusicStore.getState().media.autoplay).toBe(true);
  });
});
