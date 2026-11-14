/**
 * Pre-join capture helpers shared by the preview screen and the room, so the
 * tracks a user tested are the exact tracks that get published.
 */

export type CaptureKind = "audio" | "video";

/** Same processing the room applies, so the preview sounds like the call. */
export function audioCaptureConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  };
}

export function videoCaptureConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  };
}

export function captureConstraints(kind: CaptureKind, deviceId?: string) {
  return kind === "audio" ? audioCaptureConstraints(deviceId) : videoCaptureConstraints(deviceId);
}

export function isLiveTrack(track: MediaStreamTrack | null | undefined): track is MediaStreamTrack {
  return Boolean(track && track.readyState === "live");
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/**
 * Asks for microphone and camera in one getUserMedia call so browsers show a
 * single permission prompt. Individual consumers then `take` their track; a
 * failed combined request yields nothing and callers fall back to opening each
 * device on its own, which also produces a precise per-device error.
 */
export class MediaPrimer {
  private readonly pending: Promise<MediaStream | null>;
  private readonly taken = new Set<CaptureKind>();
  private disposed = false;

  constructor(
    request: { audio?: MediaTrackConstraints; video?: MediaTrackConstraints },
    getUserMedia: GetUserMedia,
  ) {
    this.pending = getUserMedia(request).catch(() => null);
  }

  async take(kind: CaptureKind): Promise<MediaStream | null> {
    if (this.taken.has(kind) || this.disposed) return null;
    this.taken.add(kind);
    const stream = await this.pending;
    const track = stream?.getTracks().find((item) => item.kind === kind);
    if (!stream || !isLiveTrack(track)) return null;
    if (this.disposed) {
      track.stop();
      return null;
    }
    stream.removeTrack(track);
    return new MediaStream([track]);
  }

  /** Stops anything nobody claimed. */
  dispose() {
    this.disposed = true;
    void this.pending.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
  }
}

/**
 * Flags a microphone that delivers (near) silence for a while: muted at the
 * OS/hardware level, the wrong input, or a dead device.
 */
export class SilenceDetector {
  private quietSince: number | null = null;

  constructor(
    private readonly threshold = 0.04,
    private readonly windowMs = 4000,
  ) {}

  /** Returns true while the input has stayed below the threshold long enough. */
  update(level: number, now: number, hardwareMuted = false): boolean {
    if (!hardwareMuted && level >= this.threshold) {
      this.quietSince = null;
      return false;
    }
    this.quietSince ??= now;
    return now - this.quietSince >= this.windowMs;
  }

  reset() {
    this.quietSince = null;
  }
}

/** Whether this browser can route audio to a chosen output device. */
export function supportsAudioOutputSelection(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

export async function applyAudioOutput(element: HTMLMediaElement, deviceId: string) {
  const sink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (!deviceId || typeof sink.setSinkId !== "function") return;
  try {
    await sink.setSinkId(deviceId);
  } catch {
    // A removed device falls back to the system default output.
  }
}
