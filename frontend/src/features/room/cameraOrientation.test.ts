import { describe, expect, it } from "vitest";
import { Track } from "livekit-client";
import type { TrackReference } from "@livekit/components-react";
import { isFrontCameraSelfView } from "./cameraOrientation";

function reference(isLocal: boolean, source: Track.Source, facingMode?: string): TrackReference {
  return {
    participant: { isLocal }, source,
    publication: { track: { mediaStreamTrack: { getSettings: () => ({ facingMode }) } } },
  } as unknown as TrackReference;
}

describe("camera orientation", () => {
  it("mirrors only local front or unknown-facing camera presentation", () => {
    expect(isFrontCameraSelfView(reference(true, Track.Source.Camera, "user"))).toBe(true);
    expect(isFrontCameraSelfView(reference(true, Track.Source.Camera))).toBe(true);
    expect(isFrontCameraSelfView(reference(true, Track.Source.Camera, "environment"))).toBe(false);
    expect(isFrontCameraSelfView(reference(false, Track.Source.Camera, "user"))).toBe(false);
    expect(isFrontCameraSelfView(reference(true, Track.Source.ScreenShare, "user"))).toBe(false);
  });
});
