"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Script from "next/script";
import { emptyMedia, useMusicStore } from "@/stores/useMusicStore";
import { useMusicPlayerStore } from "@/stores/useMusicPlayerStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { canonicalPositionMs, driftCorrection } from "./mediaClock";
import { useRoomSession } from "./RoomSession";

interface YouTubePlayer {
  cueVideoById(id: string, startSeconds?: number): void;
  loadVideoById?(id: string, startSeconds?: number): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate?(): number;
  getAvailablePlaybackRates?(): number[];
  setPlaybackRate?(rate: number): void;
  setVolume(volume: number): void;
  unMute?(): void;
  destroy(): void;
}

interface YouTubeAPI {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      playerVars: {
        playsinline: number;
        origin: string;
        controls: number;
        modestbranding: number;
        rel: number;
      };
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event?: { data?: number }) => void;
        onAutoplayBlocked: () => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Owns the YouTube iframe for the lifetime of a room. The surface is supplied
 * by MusicDrawer, but playback deliberately is not: closing or replacing a
 * drawer must never destroy the room's local music player.
 */
export function MusicPlayback({ surface }: { surface: HTMLDivElement | null }) {
  const media = useMusicStore((state) => state.media ?? emptyMedia);
  const error = useMusicStore((state) => state.error);
  const clockOffset = useMusicStore((state) => state.clockOffsetMs);
  const self = useRoomStore((state) => state.self);
  const room = useRoomStore((state) => state.room);
  const session = useRoomSession();
  const volume = useMusicPlayerStore((state) => state.volume);
  const activated = useMusicPlayerStore((state) => state.activated);

  const [apiReady, setApiReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.YT?.Player),
  );
  // React owns only this wrapper. The YouTube SDK mutates/removes its mount
  // node, so keep that node outside React's child reconciliation tree.
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const loadedVideo = useRef<string | null>(null);
  const pendingVersion = useRef<number | null>(null);
  const durationReport = useRef<{ key: string; at: number } | null>(null);
  const canControl = Boolean(
    self?.identity_type === "user" && room?.owner_id === self.identity_id,
  );
  const latest = useRef({
    media,
    clockOffset,
    volume,
    activated,
    canControl,
    sendCommand: session.sendCommand,
  });

  useEffect(() => {
    latest.current = {
      media,
      clockOffset,
      volume,
      activated,
      canControl,
      sendCommand: session.sendCommand,
    };
  }, [media, clockOffset, volume, activated, canControl, session.sendCommand]);

  useEffect(() => {
    useMusicPlayerStore.getState().hydrate();
  }, []);

  const enableAudio = () => {
    const player = playerRef.current;
    if (!player) return false;

    // This is called directly from a user gesture whenever possible. Effects
    // that run after a click do not reliably retain browser user activation.
    player.unMute?.();
    player.setVolume(useMusicPlayerStore.getState().volume);
    if (latest.current.media.status === "PLAYING") player.playVideo();
    return true;
  };

  useEffect(() => {
    const activationHandler = () => enableAudio();
    useMusicPlayerStore.getState().setAudioActivationHandler(activationHandler);
    return () => {
      if (
        useMusicPlayerStore.getState().audioActivationHandler ===
        activationHandler
      ) {
        useMusicPlayerStore.getState().setAudioActivationHandler(null);
      }
    };
  }, []);

  // The IFrame API invokes this global callback as soon as its script finishes
  // evaluating. Register it before Next's Script callback runs so a fast load
  // cannot miss the one-shot signal.
  useEffect(() => {
    if (window.YT?.Player) return;

    const previousCallback = window.onYouTubeIframeAPIReady;
    const markReady = () => setApiReady(true);
    const callback = () => {
      previousCallback?.();
      markReady();
    };
    window.onYouTubeIframeAPIReady = callback;

    const readinessCheck = window.setInterval(() => {
      if (window.YT?.Player) {
        markReady();
        window.clearInterval(readinessCheck);
      }
    }, 100);
    const stopReadinessCheck = window.setTimeout(
      () => window.clearInterval(readinessCheck),
      10_000,
    );

    return () => {
      window.clearInterval(readinessCheck);
      window.clearTimeout(stopReadinessCheck);
      if (window.onYouTubeIframeAPIReady === callback) {
        window.onYouTubeIframeAPIReady = previousCallback;
      }
    };
  }, []);

  useEffect(() => {
    if (
      pendingVersion.current !== null &&
      media.version !== pendingVersion.current
    ) {
      pendingVersion.current = null;
    }
  }, [media.version]);

  useEffect(() => {
    if (error) pendingVersion.current = null;
  }, [error]);

  useEffect(() => {
    if (!apiReady || !surface || !playerHostRef.current || !window.YT?.Player) {
      return;
    }

    const host = playerHostRef.current;
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    host.appendChild(container);
    let disposed = false;
    const instance = new window.YT.Player(container, {
      width: "100%",
      height: "100%",
      playerVars: {
        playsinline: 1,
        origin: location.origin,
        controls: 0,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          if (disposed) return;
          playerRef.current = instance;
          useMusicPlayerStore.getState().setPlayerReady(true);
          instance.setVolume(latest.current.volume);

          const state = latest.current.media;
          if (state.current) {
            loadedVideo.current = state.current.video_id;
            const targetPosSec =
              canonicalPositionMs(
                state.position_ms,
                state.started_at,
                state.status,
                Date.now() + latest.current.clockOffset,
              ) / 1000;
            instance.cueVideoById(state.current.video_id, targetPosSec);
          }

          if (useMusicPlayerStore.getState().activationRequested) {
            // The click that opened the drawer happened before the iframe
            // existed, so it is no longer a reliable browser user gesture.
            // Keep the explicit fallback visible instead of reporting audio
            // as enabled and then immediately being blocked by the browser.
            useMusicPlayerStore.getState().setActivated(false);
          } else if (latest.current.activated && state.status === "PLAYING") {
            instance.playVideo();
          }
        },
        onStateChange: ({ data }) => {
          if (disposed) return;
          const state = latest.current.media;
          const duration = instance.getDuration();
          if (duration > 0) {
            useMusicPlayerStore
              .getState()
              .setPlaybackProgress(useMusicPlayerStore.getState().currentTime, duration);
          }

          // Track naturally ended (YT.PlayerState.ENDED === 0)
          if (data === 0 && latest.current.canControl && state.current) {
            latest.current.sendCommand("media.ended", {
              expected_version: state.version,
              video_id: state.current.video_id,
            });
          }

          // Cued and ready to play.
          if (
            data === 5 &&
            state.status === "PLAYING" &&
            latest.current.activated
          ) {
            instance.playVideo();
          }
        },
        onError: (event: { data?: number } | undefined) => {
          const code = event?.data;
          let message = "This YouTube video cannot play here.";
          if (code === 2) {
            message = "Invalid YouTube video ID.";
          } else if (code === 5) {
            message = "HTML5 player error on this YouTube video.";
          } else if (code === 100) {
            message = "This YouTube video was not found or has been removed.";
          } else if (code === 101 || code === 150) {
            message = "The video owner has disabled embedded playback.";
          }

          useMusicStore.getState().setError(`${message} Skipping to next track...`);
          if (latest.current.canControl && latest.current.media.current) {
            latest.current.sendCommand("media.unavailable", {
              expected_version: latest.current.media.version,
              video_id: latest.current.media.current.video_id,
              reason: message,
            });
          }
        },
        onAutoplayBlocked: () => {
          // Some browsers still require a second explicit click for a
          // cross-origin iframe. The drawer keeps a fallback button for it.
          if (instance.getPlayerState() !== 1) {
            useMusicPlayerStore.getState().setActivated(false);
          }
        },
      },
    });

    return () => {
      disposed = true;
      if (playerRef.current === instance) playerRef.current = null;
      useMusicPlayerStore.getState().setPlayerReady(false);
      try {
        instance.destroy();
      } catch {
        // The iframe can already have been removed by the provider.
      }
      if (container.parentNode === host) {
        host.removeChild(container);
      }
      loadedVideo.current = null;
    };
  }, [apiReady, surface]);

  // Keep the local player aligned to the room authority. The authoritative
  // media state remains in the room store; this only controls local playback.
  useEffect(() => {
    const instance = playerRef.current;
    if (!instance) return;

    if (!media.current) {
      if (loadedVideo.current) instance.stopVideo();
      loadedVideo.current = null;
      useMusicPlayerStore.getState().setPlaybackProgress(0, 0);
      return;
    }

    const target =
      canonicalPositionMs(
        media.position_ms,
        media.started_at,
        media.status,
        Date.now() + clockOffset,
      ) / 1000;

    if (loadedVideo.current !== media.current.video_id) {
      loadedVideo.current = media.current.video_id;
      instance.setVolume(volume);
      if (activated) instance.unMute?.();
      if (activated && media.status === "PLAYING") {
        if (typeof instance.loadVideoById === "function") {
          instance.loadVideoById(media.current.video_id, target);
        } else {
          instance.cueVideoById(media.current.video_id, target);
          instance.playVideo();
        }
      } else {
        instance.cueVideoById(media.current.video_id, target);
      }
    } else if (Math.abs(instance.getCurrentTime() - target) > 1.5) {
      instance.seekTo(target, true);
    }

    if (activated && media.status === "PLAYING") {
      if (instance.getPlayerState() !== 1) instance.playVideo();
    } else {
      instance.pauseVideo();
      if (instance.getPlaybackRate?.() !== 1) instance.setPlaybackRate?.(1);
    }
  }, [media, clockOffset, activated, volume]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const instance = playerRef.current;
      const state = latest.current;
      if (!instance || !state.media.current) return;

      const currentTime =
        state.media.status === "PLAYING"
          ? canonicalPositionMs(
              state.media.position_ms,
              state.media.started_at,
              state.media.status,
              Date.now() + state.clockOffset,
            ) / 1000
          : state.media.position_ms / 1000;
      const duration = instance.getDuration();
      useMusicPlayerStore
        .getState()
        .setPlaybackProgress(currentTime, duration > 0 ? duration : 0);

      if (duration <= 0 || !state.canControl || !state.media.current) return;
      const seconds = Math.ceil(duration);
      const reportKey = `${state.media.current.id}:${state.media.version}:${seconds}`;
      if (
        state.media.current.duration_sec !== seconds &&
        pendingVersion.current === null &&
        (durationReport.current?.key !== reportKey ||
          Date.now() - durationReport.current.at > 10_000)
      ) {
        if (
          state.sendCommand("media.duration", {
            expected_version: state.media.version,
            video_id: state.media.current.video_id,
            duration_sec: seconds,
          })
        ) {
          durationReport.current = { key: reportKey, at: Date.now() };
        }
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const resyncTimer = window.setInterval(() => {
      const instance = playerRef.current;
      const state = latest.current;
      if (!instance || !state.media.current) return;

      const playerState = instance.getPlayerState();
      if (state.media.status !== "PLAYING" || !state.activated) {
        if (playerState === 1) instance.pauseVideo();
        return;
      }

      if (playerState === 2 || playerState === 5) {
        instance.playVideo();
        return;
      }

      if (playerState !== 1) return;
      const target =
        canonicalPositionMs(
          state.media.position_ms,
          state.media.started_at,
          state.media.status,
          Date.now() + state.clockOffset,
        ) / 1000;
      const correction = driftCorrection(
        instance.getCurrentTime() * 1000,
        target * 1000,
        instance.getPlaybackRate?.() ?? 1,
        instance.getAvailablePlaybackRates?.() ?? [1],
      );
      if (correction.kind === "seek") {
        instance.seekTo(correction.positionMs / 1000, true);
        if (instance.getPlaybackRate?.() !== 1) instance.setPlaybackRate?.(1);
      } else if (correction.kind === "rate") {
        instance.setPlaybackRate?.(correction.rate);
      }
    }, 1000);

    return () => window.clearInterval(resyncTimer);
  }, []);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance) return;
    instance.setVolume(volume);
    if (activated) instance.unMute?.();
  }, [volume, activated]);

  useEffect(() => {
    return () => useMusicPlayerStore.getState().resetPlayback();
  }, []);

  return (
    <>
      <Script
        src="https://www.youtube.com/iframe_api"
        strategy="afterInteractive"
        onReady={() => {
          if (window.YT?.Player) setApiReady(true);
        }}
        onError={() => {
          useMusicStore
            .getState()
            .setError("Unable to load the YouTube player. Check your connection and try again.");
        }}
      />
      {surface
        ? createPortal(
            <div ref={playerHostRef} className="h-full w-full" />,
            surface,
          )
        : null}
    </>
  );
}
