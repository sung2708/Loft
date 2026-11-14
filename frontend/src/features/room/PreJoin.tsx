"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import Link from "next/link";
import { AlertTriangle, Mic, MicOff, Video, VideoOff, Volume2 } from "lucide-react";
import { useUIText } from "@/lib/i18n/uiText";
import { preloadSfx, sfxManifest, unlockSfx } from "@/lib/sfx";
import { API_URL, LIVEKIT_URL } from "@/lib/config";
import { useMediaPrefsStore } from "@/stores/useMediaPrefsStore";
import { extractErrorDetails, formatMediaError, isSecureMediaContext } from "./mediaErrors";
import {
  MediaPrimer,
  SilenceDetector,
  applyAudioOutput,
  audioCaptureConstraints,
  captureConstraints,
  isLiveTrack,
  supportsAudioOutputSelection,
  videoCaptureConstraints,
  type CaptureKind,
} from "./previewMedia";

export type JoinMedia = {
  mic: boolean;
  camera: boolean;
  /**
   * Live preview tracks handed to the room so it publishes what the user just
   * tested instead of reopening the devices. The room owns (and stops) them.
   */
  tracks?: { audio?: MediaStreamTrack; video?: MediaStreamTrack };
};

type DeviceOption = { deviceId: string; label: string };
type Blocked = { mic: boolean; camera: boolean };

/** LiveKit signals over wss, but the TLS handshake is shared with https. */
function liveKitOrigin(url: string) {
  try {
    const parsed = new URL(url.replace(/^ws/, "http"));
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Prefer the saved device, but fall back to any device if it disappeared. */
async function openStream(kind: CaptureKind, deviceId: string): Promise<MediaStream> {
  const base = captureConstraints(kind);
  const request = (constraints: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia({ [kind]: constraints });
  if (!deviceId) return request(base);
  try {
    return await request({ ...base, deviceId: { exact: deviceId } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name !== "OverconstrainedError" && name !== "NotFoundError") throw error;
    return request(base);
  }
}

/** RMS of a time-domain buffer mapped to 0..1 with a speech-friendly curve. */
export function levelFromSamples(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 4);
}

const isPermissionDenied = (error: unknown) =>
  extractErrorDetails(error).name === "NotAllowedError";

export function PreJoin({
  roomName,
  displayName,
  onJoin,
}: {
  roomName?: string;
  displayName?: string;
  onJoin: (media: JoinMedia) => void;
}) {
  const tr = useUIText();
  const updatePrefs = useMediaPrefsStore((state) => state.update);
  // PreJoin only mounts client-side (after the credential effect), so the
  // saved preferences can seed state directly.
  const [initial] = useState(() => {
    useMediaPrefsStore.getState().hydrate();
    return {
      prefs: useMediaPrefsStore.getState(),
      secure: isSecureMediaContext(),
      outputSelectable: supportsAudioOutputSelection(),
    };
  });
  const { secure, outputSelectable } = initial;
  const [micOn, setMicOn] = useState(secure && initial.prefs.micOnJoin);
  const [cameraOn, setCameraOn] = useState(secure && initial.prefs.cameraOnJoin);
  const [audioId, setAudioId] = useState(initial.prefs.audioDeviceId);
  const [videoId, setVideoId] = useState(initial.prefs.videoDeviceId);
  const [outputId, setOutputId] = useState(initial.prefs.audioOutputDeviceId);
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<DeviceOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked>({ mic: false, camera: false });
  const [silent, setSilent] = useState(false);
  const [testingOutput, setTestingOutput] = useState(false);
  const [joining, setJoining] = useState(false);
  const [mirrored, setMirrored] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const videoStream = useRef<MediaStream | null>(null);
  const primer = useRef<MediaPrimer | null>(null);
  // Tracks given to the room on join; effect cleanups must not stop them.
  const handedOff = useRef(new Set<MediaStreamTrack>());
  const testAudio = useRef<HTMLAudioElement | null>(null);

  // Warm DNS/TLS for the API and media server and pull sound cues into cache
  // while the user is still picking devices, so joining starts hot.
  const mediaOrigin = LIVEKIT_URL ? liveKitOrigin(LIVEKIT_URL) : null;
  if (mediaOrigin) preconnect(mediaOrigin);
  preconnect(API_URL);
  useEffect(() => {
    preloadSfx();
  }, []);

  const release = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => {
      if (!handedOff.current.has(track)) track.stop();
    });
  }, []);

  const refreshDevices = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve();
    const apply = (devices: MediaDeviceInfo[]) => {
      const options = (kind: MediaDeviceKind, fallback: string) =>
        devices
          .filter((device) => device.kind === kind && device.deviceId)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `${fallback} ${index + 1}`,
          }));
      setMics(options("audioinput", tr("Microphone")));
      setCameras(options("videoinput", tr("Camera")));
      if (outputSelectable) setSpeakers(options("audiooutput", tr("Speaker")));
    };
    return navigator.mediaDevices
      .enumerateDevices()
      .then(apply)
      .catch(() => {
        // Device labels are optional; the default device still works.
      });
  }, [tr, outputSelectable]);

  useEffect(() => {
    if (!secure) return;
    void refreshDevices();
    const devices = navigator.mediaDevices;
    devices?.addEventListener?.("devicechange", refreshDevices);
    return () => devices?.removeEventListener?.("devicechange", refreshDevices);
  }, [secure, refreshDevices]);

  // One permission prompt for both devices when both start enabled. Declared
  // before the per-device effects so they can claim its tracks.
  useEffect(() => {
    if (!initial.secure || !initial.prefs.micOnJoin || !initial.prefs.cameraOnJoin) return;
    const current = new MediaPrimer(
      {
        audio: audioCaptureConstraints(initial.prefs.audioDeviceId || undefined),
        video: videoCaptureConstraints(initial.prefs.videoDeviceId || undefined),
      },
      (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    );
    primer.current = current;
    return () => {
      current.dispose();
      if (primer.current === current) primer.current = null;
    };
  }, [initial]);

  const acquire = useCallback(
    async (kind: CaptureKind, deviceId: string, isCancelled: () => boolean) => {
      const primed = await (primer.current?.take(kind) ?? Promise.resolve(null));
      if (primed || isCancelled()) return primed;
      return openStream(kind, deviceId);
    },
    [],
  );

  const markBlocked = useCallback((kind: keyof Blocked, caught: unknown) => {
    if (isPermissionDenied(caught)) setBlocked((current) => ({ ...current, [kind]: true }));
  }, []);

  // Camera preview. Every resolved stream is stopped if the effect was
  // superseded, so toggling quickly never leaks an open camera.
  useEffect(() => {
    if (!cameraOn || !secure) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    void acquire("video", videoId, () => cancelled)
      .then((opened) => {
        if (cancelled || !opened) return release(opened);
        stream = opened;
        videoStream.current = opened;
        const track = opened.getVideoTracks()[0];
        setMirrored(track?.getSettings().facingMode !== "environment");
        if (video) video.srcObject = opened;
        setError(null);
        setBlocked((current) => (current.camera ? { ...current, camera: false } : current));
        void refreshDevices();
      })
      .catch((caught) => {
        if (cancelled) return;
        setCameraOn(false);
        markBlocked("camera", caught);
        setError(formatMediaError(caught, "camera"));
      });
    return () => {
      cancelled = true;
      release(stream);
      if (videoStream.current === stream) videoStream.current = null;
      if (video) video.srcObject = null;
    };
  }, [cameraOn, videoId, secure, refreshDevices, acquire, release, markBlocked]);

  // Microphone level meter plus a "can't hear you" check. The bar is written
  // through a ref so the animation loop never re-renders the component.
  useEffect(() => {
    if (!micOn || !secure) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let reportedSilent = false;
    const detector = new SilenceDetector();
    const resumeMeter = () => {
      if (context?.state === "suspended") void context.resume().catch(() => undefined);
    };
    window.addEventListener("pointerup", resumeMeter);
    window.addEventListener("keydown", resumeMeter);
    const meter = meterRef.current;
    void acquire("audio", audioId, () => cancelled)
      .then((opened) => {
        if (cancelled || !opened) return release(opened);
        stream = opened;
        audioStream.current = opened;
        setError(null);
        setBlocked((current) => (current.mic ? { ...current, mic: false } : current));
        void refreshDevices();
        const AudioCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtor) return;
        context = new AudioCtor();
        void context.resume().catch(() => undefined);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(opened).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const track = opened.getAudioTracks()[0];
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          const level = levelFromSamples(samples);
          if (meter) meter.style.transform = `scaleX(${level})`;
          // A suspended context reads flat silence; only judge real input.
          if (context?.state === "running") {
            const isSilent = detector.update(level, performance.now(), Boolean(track?.muted));
            if (isSilent !== reportedSilent) {
              reportedSilent = isSilent;
              setSilent(isSilent);
            }
          } else {
            detector.reset();
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((caught) => {
        if (cancelled) return;
        setMicOn(false);
        markBlocked("mic", caught);
        setError(formatMediaError(caught, "mic"));
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerup", resumeMeter);
      window.removeEventListener("keydown", resumeMeter);
      void context?.close().catch(() => undefined);
      release(stream);
      if (audioStream.current === stream) audioStream.current = null;
      if (meter) meter.style.transform = "scaleX(0)";
      setSilent(false);
    };
  }, [micOn, audioId, secure, refreshDevices, acquire, release, markBlocked]);

  // When the user unblocks access in the browser UI, retry automatically
  // where the Permissions API can tell us (Chromium; others use the button).
  useEffect(() => {
    if (!blocked.mic && !blocked.camera) return;
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    let active = true;
    const watched: PermissionStatus[] = [];
    const watch = (name: "microphone" | "camera", retry: () => void) => {
      permissions
        .query({ name: name as PermissionName })
        .then((status) => {
          if (!active) return;
          status.onchange = () => {
            if (status.state === "granted") retry();
          };
          watched.push(status);
        })
        .catch(() => undefined);
    };
    if (blocked.mic) watch("microphone", () => retryBlocked("mic"));
    if (blocked.camera) watch("camera", () => retryBlocked("camera"));
    return () => {
      active = false;
      for (const status of watched) status.onchange = null;
    };
    // retryBlocked only flips state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked.mic, blocked.camera]);

  function retryBlocked(kind?: keyof Blocked) {
    // With no kind (the button), retry whatever is currently blocked.
    const mic = kind ? kind === "mic" : blocked.mic;
    const camera = kind ? kind === "camera" : blocked.camera;
    setError(null);
    if (mic) setMicOn(true);
    if (camera) setCameraOn(true);
    setBlocked((current) => ({
      mic: mic ? false : current.mic,
      camera: camera ? false : current.camera,
    }));
  }

  const testOutput = () => {
    testAudio.current?.pause();
    const audio = new Audio(sfxManifest["room-enter"].src);
    audio.volume = 0.8;
    testAudio.current = audio;
    setTestingOutput(true);
    const done = () => setTestingOutput(false);
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("error", done, { once: true });
    void applyAudioOutput(audio, outputId)
      .then(() => audio.play())
      .catch(done);
  };
  useEffect(() => () => testAudio.current?.pause(), []);

  const join = () => {
    if (joining) return;
    setJoining(true);
    testAudio.current?.pause();
    unlockSfx();
    updatePrefs({
      micOnJoin: micOn,
      cameraOnJoin: cameraOn,
      audioDeviceId: audioId,
      videoDeviceId: videoId,
      audioOutputDeviceId: outputId,
    });
    const tracks: NonNullable<JoinMedia["tracks"]> = {};
    const audioTrack = audioStream.current?.getAudioTracks()[0];
    const videoTrack = videoStream.current?.getVideoTracks()[0];
    if (micOn && isLiveTrack(audioTrack)) {
      handedOff.current.add(audioTrack);
      tracks.audio = audioTrack;
    }
    if (cameraOn && isLiveTrack(videoTrack)) {
      handedOff.current.add(videoTrack);
      tracks.video = videoTrack;
    }
    onJoin({ mic: micOn, camera: cameraOn, tracks });
  };

  const toggle =
    "flex h-11 w-11 items-center justify-center rounded-full border border-white/20 backdrop-blur-xs transition-colors disabled:opacity-40";
  const select =
    "h-10 w-full min-w-0 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[13px] text-[var(--text-loft-primary)] disabled:opacity-50";
  const label = "grid min-w-0 gap-1 text-[12px] text-[var(--text-loft-muted)]";
  const anyBlocked = blocked.mic || blocked.camera;

  return (
    <main className="app-canvas utility-page flex items-center justify-center p-4">
      <section
        aria-labelledby="prejoin-title"
        className="utility-panel w-full max-w-lg rounded-[10px] p-4 sm:p-6"
      >
        <h1
          id="prejoin-title"
          className="truncate text-base font-medium tracking-tight"
        >
          {roomName ?? tr("Join room")}
        </h1>
        {displayName ? (
          <p className="mt-1 truncate text-[13px] text-[var(--text-loft-secondary)]">
            {displayName}
          </p>
        ) : null}

        <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-[10px] bg-[#101113]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label={tr("Camera preview")}
            className={`h-full w-full object-cover ${cameraOn ? "" : "invisible"}`}
            style={mirrored ? { transform: "scaleX(-1)" } : undefined}
          />
          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/60">
              {tr("Camera off")}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
            <button
              type="button"
              disabled={!secure}
              aria-pressed={micOn}
              aria-label={tr("Microphone")}
              title={tr("Microphone")}
              onClick={() => setMicOn((value) => !value)}
              className={`${toggle} ${micOn ? "bg-white/15 text-white" : "bg-white text-[#101113]"}`}
            >
              {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              disabled={!secure}
              aria-pressed={cameraOn}
              aria-label={tr("Camera")}
              title={tr("Camera")}
              onClick={() => setCameraOn((value) => !value)}
              className={`${toggle} ${cameraOn ? "bg-white/15 text-white" : "bg-white text-[#101113]"}`}
            >
              {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {micOn ? (
            <Mic className="h-3.5 w-3.5 shrink-0 text-[var(--text-loft-muted)]" aria-hidden />
          ) : (
            <MicOff className="h-3.5 w-3.5 shrink-0 text-[var(--text-loft-muted)]" aria-hidden />
          )}
          <span className="sr-only">{tr("Microphone level")}</span>
          <div
            aria-hidden="true"
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border-loft)]"
          >
            <div
              ref={meterRef}
              className="h-full w-full origin-left rounded-full bg-[var(--text-loft-primary)] transition-transform duration-75"
              style={{ transform: "scaleX(0)" }}
            />
          </div>
        </div>
        {micOn && silent && (
          <p
            role="status"
            className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--text-loft-secondary)]"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {tr("We can’t hear you. Check that your microphone isn’t muted, or pick another one.")}
          </p>
        )}

        {secure ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={label}>
              {tr("Microphone")}
              <select
                className={select}
                value={audioId}
                disabled={mics.length === 0}
                onChange={(event) => setAudioId(event.target.value)}
              >
                <option value="">{tr("Default")}</option>
                {mics.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              {tr("Camera")}
              <select
                className={select}
                value={videoId}
                disabled={cameras.length === 0}
                onChange={(event) => setVideoId(event.target.value)}
              >
                <option value="">{tr("Default")}</option>
                {cameras.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={`${label} sm:col-span-2`}>
              <label htmlFor="prejoin-speaker">{tr("Speaker")}</label>
              <div className="flex min-w-0 gap-2">
                {outputSelectable ? (
                  <select
                    id="prejoin-speaker"
                    className={select}
                    value={outputId}
                    disabled={speakers.length === 0}
                    onChange={(event) => setOutputId(event.target.value)}
                  >
                    <option value="">{tr("Default")}</option>
                    {speakers.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p id="prejoin-speaker" className="flex h-10 min-w-0 flex-1 items-center text-[13px] text-[var(--text-loft-secondary)]">
                    {tr("System default")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={testOutput}
                  disabled={testingOutput}
                  className="control-secondary inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium disabled:opacity-60"
                >
                  <Volume2 className="h-4 w-4" aria-hidden />
                  {tr(testingOutput ? "Playing…" : "Test sound")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p role="status" className="mt-4 text-[13px] text-[var(--text-loft-secondary)]">
            {tr("Media access requires a secure HTTPS connection.")}
          </p>
        )}

        {anyBlocked ? (
          <div
            role="alert"
            className="mt-3 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-3 text-[13px]"
          >
            <p className="font-medium text-[var(--text-loft-primary)]">
              {tr(
                blocked.mic && blocked.camera
                  ? "Microphone and camera are blocked"
                  : blocked.mic
                    ? "Microphone access was blocked."
                    : "Camera access was blocked.",
              )}
            </p>
            <p className="mt-1 text-[var(--text-loft-secondary)]">
              {tr(
                "Click the lock or camera icon in the address bar, allow access for this site, then try again.",
              )}
            </p>
            <button
              type="button"
              onClick={() => retryBlocked()}
              className="control-secondary mt-2 inline-flex h-8 items-center rounded-[10px] px-3 text-[13px] font-medium"
            >
              {tr("Try again")}
            </button>
          </div>
        ) : (
          error && (
            <p role="alert" className="mt-3 text-[13px] text-[var(--text-loft-primary)]">
              {error}
            </p>
          )
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Link
            href="/"
            className="control-secondary inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-medium"
          >
            {tr("Cancel")}
          </Link>
          <button
            type="button"
            onClick={join}
            disabled={joining}
            aria-busy={joining}
            className="control-primary inline-flex h-10 items-center rounded-[10px] px-5 text-[13px] font-medium disabled:opacity-70"
          >
            {tr(joining ? "Joining…" : "Join")}
          </button>
        </div>
      </section>
    </main>
  );
}
