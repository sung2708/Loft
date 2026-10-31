import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CSSProperties } from "react";
import type { TrackReference } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { ApiParticipant } from "@/types/api";

const media = vi.hoisted(() => ({ participants: [] as ApiParticipant[], tracks: [] as TrackReference[] }));
vi.mock("@/stores/useRoomStore", () => ({
  useRoomStore: (selector: (state: { participants: ApiParticipant[] }) => unknown) => selector(media),
}));
vi.mock("@livekit/components-react", async (original) => ({
  ...await original<typeof import("@livekit/components-react")>(),
  useParticipants: () => [],
  useTracks: () => media.tracks,
  VideoTrack: ({ trackRef, className, style }: {trackRef: TrackReference; className: string; style?: CSSProperties}) => (
    <video data-source={trackRef.source} className={className} style={style} />
  ),
}));
import { MediaStage } from "./RoomSession";

function renderShare(count: number) {
  media.participants = Array.from({ length: count }, (_, index) => ({
    connection_id: `connection-${index}`, identity_id: `user-${index}`, identity_type: "user",
    livekit_identity: `user:user-${index}`, display_name: `Participant ${index + 1}`,
    role: index === 0 ? "host" : "member", joined_at: "2026-10-31T00:00:00Z",
  } as ApiParticipant));
  media.tracks = [{ source: Track.Source.ScreenShare, publication: { isMuted: false },
    participant: { identity: "user:user-0", name: "Participant 1", isLocal: true },
  } as unknown as TrackReference];
  return renderToStaticMarkup(<MediaStage />);
}

describe("screen share presentation", () => {
  beforeEach(() => { media.participants = []; media.tracks = []; });
  it("shows the complete unmirrored screen above the participant strip", () => {
    const html = renderShare(1);
    expect(html).toContain('data-testid="screen-share-stage"');
    expect(html).toContain('object-fit:contain');
    expect(html).not.toContain('object-cover');
    expect(html).not.toContain('-scale-x-100');
    expect(html.indexOf('screen-share-viewport')).toBeLessThan(html.indexOf('role="region"'));
    expect(html).not.toContain('lg:grid-cols');
  });
  it.each([1, 6, 12])("keeps all %i participants in one bounded horizontal strip", count => {
    const html = renderShare(count);
    expect(html).toContain('overflow-x-auto overflow-y-hidden');
    expect(html).toContain('grid-rows-[minmax(0,1fr)_88px]');
    expect(html).toContain('sm:grid-rows-[minmax(0,1fr)_104px]');
    expect(html.match(/w-28 h-16 shrink-0/g)).toHaveLength(count);
    expect(html).toContain(`Participant ${count}`);
    expect(html).not.toContain('lg:flex-col');
  });
});
