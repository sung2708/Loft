import { Track } from "livekit-client";
import type { TrackReference } from "@livekit/components-react";

export function isFrontCameraSelfView(camera: TrackReference) {
  if (!camera.participant.isLocal || camera.source !== Track.Source.Camera) return false;
  return camera.publication?.track?.mediaStreamTrack.getSettings().facingMode !== "environment";
}
