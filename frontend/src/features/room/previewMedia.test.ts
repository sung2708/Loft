import { describe, expect, it, vi } from "vitest";
import { MediaPrimer, SilenceDetector, audioCaptureConstraints, videoCaptureConstraints } from "./previewMedia";

class FakeTrack {
  readyState: "live" | "ended" = "live";
  constructor(public kind: "audio" | "video") {}
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}
  getTracks() {
    return [...this.tracks];
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((item) => item !== track);
  }
}

vi.stubGlobal("MediaStream", FakeStream);

describe("MediaPrimer", () => {
  it("asks once and hands each kind out exactly once", async () => {
    const audio = new FakeTrack("audio");
    const video = new FakeTrack("video");
    const gum = vi.fn(async () => new FakeStream([audio, video]) as unknown as MediaStream);
    const primer = new MediaPrimer({ audio: {}, video: {} }, gum);
    const [mic, cam] = await Promise.all([primer.take("audio"), primer.take("video")]);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(mic?.getTracks()).toEqual([audio]);
    expect(cam?.getTracks()).toEqual([video]);
    expect(await primer.take("audio")).toBeNull();
  });

  it("falls back to per-device requests when the combined request fails", async () => {
    const primer = new MediaPrimer({ audio: {}, video: {} }, async () => {
      throw new DOMException("no camera", "NotFoundError");
    });
    expect(await primer.take("video")).toBeNull();
  });

  it("stops unclaimed tracks on dispose", async () => {
    const audio = new FakeTrack("audio");
    const video = new FakeTrack("video");
    const primer = new MediaPrimer({ audio: {}, video: {} }, async () => new FakeStream([audio, video]) as unknown as MediaStream);
    await primer.take("audio");
    primer.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });
});

describe("SilenceDetector", () => {
  it("flags sustained silence and clears on speech", () => {
    const detector = new SilenceDetector(0.04, 4000);
    expect(detector.update(0.01, 0)).toBe(false);
    expect(detector.update(0.01, 3999)).toBe(false);
    expect(detector.update(0.01, 4000)).toBe(true);
    expect(detector.update(0.2, 4100)).toBe(false);
    expect(detector.update(0.01, 4200)).toBe(false);
  });

  it("treats a hardware-muted track as silent even with noise", () => {
    const detector = new SilenceDetector(0.04, 1000);
    detector.update(0.5, 0, true);
    expect(detector.update(0.5, 1000, true)).toBe(true);
  });
});

describe("capture constraints", () => {
  it("prefer the saved device without failing when it is gone", () => {
    expect(audioCaptureConstraints("mic-1").deviceId).toEqual({ ideal: "mic-1" });
    expect(videoCaptureConstraints().deviceId).toBeUndefined();
    expect(audioCaptureConstraints().echoCancellation).toBe(true);
  });
});
