"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useUIText } from "@/lib/i18n/uiText";
import { unlockSfx } from "@/lib/sfx";
import { useMediaPrefsStore } from "@/stores/useMediaPrefsStore";
import { formatMediaError, isSecureMediaContext } from "./mediaErrors";

export type JoinMedia = { mic: boolean; camera: boolean };

type DeviceOption = { deviceId: string; label: string };

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Prefer the saved device, but fall back to any device if it disappeared. */
async function openStream(
  kind: "audio" | "video",
  deviceId: string,
): Promise<MediaStream> {
  const base: MediaTrackConstraints =
    kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : {};
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
    };
  });
  const { secure } = initial;
  const [micOn, setMicOn] = useState(secure && initial.prefs.micOnJoin);
  const [cameraOn, setCameraOn] = useState(secure && initial.prefs.cameraOnJoin);
  const [audioId, setAudioId] = useState(initial.prefs.audioDeviceId);
  const [videoId, setVideoId] = useState(initial.prefs.videoDeviceId);
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

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
    };
    return navigator.mediaDevices
      .enumerateDevices()
      .then(apply)
      .catch(() => {
        // Device labels are optional; the default device still works.
      });
  }, [tr]);

  useEffect(() => {
    if (!secure) return;
    void refreshDevices();
    const devices = navigator.mediaDevices;
    devices?.addEventListener?.("devicechange", refreshDevices);
    return () => devices?.removeEventListener?.("devicechange", refreshDevices);
  }, [secure, refreshDevices]);

  // Camera preview. Every resolved stream is stopped if the effect was
  // superseded, so toggling quickly never leaks an open camera.
  useEffect(() => {
    if (!cameraOn || !secure) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    void openStream("video", videoId)
      .then((opened) => {
        if (cancelled) return stopStream(opened);
        stream = opened;
        const track = opened.getVideoTracks()[0];
        setMirrored(track?.getSettings().facingMode !== "environment");
        if (video) video.srcObject = opened;
        setError(null);
        void refreshDevices();
      })
      .catch((caught) => {
        if (cancelled) return;
        setCameraOn(false);
        setError(formatMediaError(caught, "camera"));
      });
    return () => {
      cancelled = true;
      stopStream(stream);
      if (video) video.srcObject = null;
    };
  }, [cameraOn, videoId, secure, refreshDevices]);

  // Microphone level meter; the bar is written through a ref so the
  // animation loop never re-renders the component.
  useEffect(() => {
    if (!micOn || !secure) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    const resumeMeter = () => {
      if (context?.state === "suspended") void context.resume().catch(() => undefined);
    };
    window.addEventListener("pointerup", resumeMeter);
    window.addEventListener("keydown", resumeMeter);
    const meter = meterRef.current;
    void openStream("audio", audioId)
      .then((opened) => {
        if (cancelled) return stopStream(opened);
        stream = opened;
        setError(null);
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
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          if (meter) meter.style.transform = `scaleX(${levelFromSamples(samples)})`;
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((caught) => {
        if (cancelled) return;
        setMicOn(false);
        setError(formatMediaError(caught, "mic"));
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerup", resumeMeter);
      window.removeEventListener("keydown", resumeMeter);
      void context?.close().catch(() => undefined);
      stopStream(stream);
      if (meter) meter.style.transform = "scaleX(0)";
    };
  }, [micOn, audioId, secure, refreshDevices]);

  const join = () => {
    unlockSfx();
    updatePrefs({
      micOnJoin: micOn,
      cameraOnJoin: cameraOn,
      audioDeviceId: audioId,
      videoDeviceId: videoId,
    });
    onJoin({ mic: micOn, camera: cameraOn });
  };

  const toggle =
    "flex h-11 w-11 items-center justify-center rounded-full border border-white/20 backdrop-blur-xs transition-colors disabled:opacity-40";
  const select =
    "h-10 w-full min-w-0 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[13px] text-[var(--text-loft-primary)] disabled:opacity-50";

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

        <div
          aria-hidden="true"
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--border-loft)]"
        >
          <div
            ref={meterRef}
            className="h-full w-full origin-left bg-[var(--text-loft-primary)] transition-transform duration-75"
            style={{ transform: "scaleX(0)" }}
          />
        </div>

        {secure ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-[12px] text-[var(--text-loft-muted)]">
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
            <label className="grid min-w-0 gap-1 text-[12px] text-[var(--text-loft-muted)]">
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
          </div>
        ) : (
          <p role="status" className="mt-4 text-[13px] text-[var(--text-loft-secondary)]">
            {tr("Media access requires a secure HTTPS connection.")}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-[var(--text-loft-primary)]">
            {error}
          </p>
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
            className="control-primary inline-flex h-10 items-center rounded-[10px] px-5 text-[13px] font-medium"
          >
            {tr("Join")}
          </button>
        </div>
      </section>
    </main>
  );
}
