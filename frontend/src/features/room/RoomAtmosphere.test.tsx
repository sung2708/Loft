import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomAtmosphere } from "./RoomAtmosphere";
import { useRoomStore } from "@/stores/useRoomStore";
import { useMusicStore } from "@/stores/useMusicStore";
import type { RoomAccent, RoomAtmosphere as RoomAtmosphereMode, RoomSnapshot } from "@/types/api";

function createSnapshot(atmosphere: RoomAtmosphereMode, accent: RoomAccent, adaptive = true): RoomSnapshot {
  return {
    room: {
      id: "test-room",
      slug: "123456",
      name: "Atmosphere Test",
      owner_id: "owner-1",
      allow_guests: true,
      max_participants: 12,
      is_locked: false,
      password_required: false,
      atmosphere,
      accent,
      adaptive_media_background: adaptive,
      version: 1,
      created_at: "2026-09-15T00:00:00Z",
    },
    host: {
      connection_id: "conn-1",
      identity_id: "owner-1",
      identity_type: "user",
      generation: 1,
      version: 1,
      state: "connected",
    },
    self: {
      connection_id: "conn-1",
      identity_id: "owner-1",
      identity_type: "user",
      display_name: "Host",
      role: "host",
      livekit_identity: "user:owner-1",
      joined_at: "2026-09-15T00:00:00Z",
    },
    participants: [],
    messages: [],
  };
}

describe("RoomAtmosphere component", () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    useMusicStore.getState().reset();
  });

  it("renders with default ambient and blue attributes", () => {
    useRoomStore.getState().applySnapshot(createSnapshot("ambient", "blue"));
    const html = renderToStaticMarkup(
      <RoomAtmosphere>
        <div id="test-stage">Stage Content</div>
      </RoomAtmosphere>,
    );

    expect(html).toContain('data-atmosphere="ambient"');
    expect(html).toContain('data-accent="blue"');
    expect(html).toContain('data-adaptive="fallback"');
    expect(html).toContain('data-screen-share="false"');
    expect(html).toContain("Stage Content");
    expect(html).toContain("room-atmosphere__backdrop");
  });

  it.each([
    ["minimal", "blue"],
    ["ambient", "purple"],
    ["focus", "green"],
    ["party", "orange"],
    ["party", "rose"],
  ] as const)("renders semantic combination %s + %s without arbitrary styling", (mode, accent) => {
    useRoomStore.getState().applySnapshot(createSnapshot(mode, accent));
    const html = renderToStaticMarkup(
      <RoomAtmosphere>
        <div id="content">Live Call</div>
      </RoomAtmosphere>,
    );

    expect(html).toContain(`data-atmosphere="${mode}"`);
    expect(html).toContain(`data-accent="${accent}"`);
    // Crucial: no arbitrary inline colors or injected style
    expect(html).not.toContain("background-color:");
    expect(html).not.toContain("<style");
  });

  it("suppresses decorative treatment and marks screen-share active when screenShare=true", () => {
    useRoomStore.getState().applySnapshot(createSnapshot("party", "rose"));
    const html = renderToStaticMarkup(
      <RoomAtmosphere screenShare={true}>
        <div id="shared-screen">Screen Content</div>
      </RoomAtmosphere>,
    );

    expect(html).toContain('data-screen-share="true"');
    expect(html).toContain('data-adaptive="fallback"');
    expect(html).toContain("Screen Content");
  });

  it("uses static fallback when adaptive background is disabled in room settings", () => {
    useRoomStore.getState().applySnapshot(createSnapshot("ambient", "blue", false));
    const html = renderToStaticMarkup(
      <RoomAtmosphere>
        <div id="content">Content</div>
      </RoomAtmosphere>,
    );

    expect(html).toContain('data-adaptive="fallback"');
  });

  it("preserves children elements and structure across mode changes", () => {
    useRoomStore.getState().applySnapshot(createSnapshot("ambient", "blue"));
    const html1 = renderToStaticMarkup(
      <RoomAtmosphere>
        <video id="youtube-player" src="blob:mock" />
      </RoomAtmosphere>,
    );

    useRoomStore.getState().roomAppearanceUpdated({
      atmosphere: "party",
      accent: "rose",
      adaptive_media_background: true,
      version: 2,
    });
    const html2 = renderToStaticMarkup(
      <RoomAtmosphere>
        <video id="youtube-player" src="blob:mock" />
      </RoomAtmosphere>,
    );

    expect(html1).toContain('id="youtube-player"');
    expect(html2).toContain('id="youtube-player"');
    expect(html2).toContain('data-atmosphere="party"');
    expect(html2).toContain('data-accent="rose"');
  });
});
