export interface ScreenShareTrackState {
  publication?: {
    isMuted: boolean;
  } | null;
}

/**
 * The Stage receives only screen-share references, so publication state is
 * enough to determine whether the shared-screen presentation should be active.
 * This deliberately does not care whether the publisher is local or remote.
 */
export function hasActiveScreenShare(
  tracks: readonly ScreenShareTrackState[],
): boolean {
  return tracks.some(
    (track) => Boolean(track.publication && !track.publication.isMuted),
  );
}
