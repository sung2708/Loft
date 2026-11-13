// A permission request can finish after the room has released its tracks.
export async function finishRoomCapture<T extends { track?: { stop(): void } }>(
  signal: AbortSignal,
  capture: () => Promise<T | undefined>,
  stopLocalTracks: () => void,
) {
  if (signal.aborted) return;
  try {
    const publication = await capture();
    if (signal.aborted) publication?.track?.stop();
  } finally {
    if (signal.aborted) stopLocalTracks();
  }
}

export function stopPublishedTracks(publications: Iterable<{ track?: { stop(): void } }>) {
  for (const publication of publications) publication.track?.stop();
}
