import { expect, it, vi } from "vitest";
import { finishRoomCapture, stopPublishedTracks } from "./roomCapture";

it("stops a track when capture finishes after leaving the room", async () => {
  const lifetime = new AbortController();
  const stop = vi.fn();
  const capture = Promise.withResolvers<{ track: { stop(): void } }>();
  const stopTabAudio = vi.fn();
  const publications: { track: { stop(): void } }[] = [];
  const pending = finishRoomCapture(lifetime.signal, () => capture.promise, () =>
    stopPublishedTracks(publications),
  );

  lifetime.abort();
  publications.push({ track: { stop: stopTabAudio } });
  capture.resolve({ track: { stop } });
  await pending;

  expect(stop).toHaveBeenCalledOnce();
  expect(stopTabAudio).toHaveBeenCalledOnce();
});
