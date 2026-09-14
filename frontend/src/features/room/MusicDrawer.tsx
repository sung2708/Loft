"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Script from "next/script";
import {
  X,
  Plus,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  ExternalLink,
  Trash2,
  Shuffle,
  Repeat,
  GripVertical,
  Link2,
  Music,
} from "lucide-react";
import { emptyMedia, useMusicStore } from "@/stores/useMusicStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { useRoomSession } from "./RoomSession";
import { canonicalPositionMs } from "./mediaClock";
import { useTranslation } from "@/lib/i18n/useTranslation";

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
  getVideoData?(): { video_id: string; title?: string; author?: string };
  setVolume(volume: number): void;
  isMuted?(): boolean;
  mute?(): void;
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
        onError: () => void;
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

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function MusicDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mq = t.mediaQueue;

  const media = useMusicStore((state) => state.media ?? emptyMedia);
  const available = useMusicStore((state) => state.available);
  const error = useMusicStore((state) => state.error);
  const clockOffset = useMusicStore((state) => state.clockOffsetMs);
  const self = useRoomStore((state) => state.self);
  const room = useRoomStore((state) => state.room);
  const session = useRoomSession();

  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [activated, setActivated] = useState(false);
  const [volume, setVolume] = useState(60);
  const [isMuted, setIsMuted] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [metaMap, setMetaMap] = useState<
    Record<string, { title?: string; channel?: string }>
  >({});

  const [apiReady, setApiReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const loadedVideo = useRef<string | null>(null);
  const pendingVersion = useRef<number | null>(null);
  const durationReport = useRef<{ key: string; at: number } | null>(null);
  const metadataFetching = useRef(new Set<string>());

  const canControl = Boolean(
    self?.identity_type === "user" && room?.owner_id === self.identity_id,
  );
  const latest = useRef({
    media,
    clockOffset,
    activated,
    volume,
    canControl,
    sendCommand: session.sendCommand,
  });
  useEffect(() => {
    latest.current = {
      media,
      clockOffset,
      activated,
      volume,
      canControl,
      sendCommand: session.sendCommand,
    };
  }, [media, clockOffset, activated, volume, canControl, session.sendCommand]);

  // The IFrame API invokes this global callback as soon as its script finishes
  // evaluating. Register it before Next's Script callback runs so we cannot
  // miss that one-shot signal on a fast connection.
  useEffect(() => {
    if (window.YT?.Player) {
      setApiReady(true);
      return;
    }

    const previousCallback = window.onYouTubeIframeAPIReady;
    const markReady = () => setApiReady(true);
    const callback = () => {
      previousCallback?.();
      markReady();
    };
    window.onYouTubeIframeAPIReady = callback;

    // The callback can have fired before this component mounted (for example,
    // when navigating back to a room). Polling briefly covers that case while
    // still stopping as soon as the API is available.
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

  // Fetch title / channel metadata for active and queued videos if missing
  useEffect(() => {
    const idsToFetch = [
      media.current?.video_id,
      ...media.queue.map((item) => item.video_id),
    ].filter(Boolean) as string[];

    idsToFetch.forEach((vid) => {
      if (!metaMap[vid] && !metadataFetching.current.has(vid)) {
        metadataFetching.current.add(vid);
        fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.title) {
              setMetaMap((prev) => ({
                ...prev,
                [vid]: {
                  title: data.title,
                  channel: data.author_name || "YouTube",
                },
              }));
            }
          })
          .catch(() => {})
          .finally(() => metadataFetching.current.delete(vid));
      }
    });
  }, [media, metaMap]);

  // Initialize official YouTube Iframe Player
  useEffect(() => {
    if (!apiReady || !containerRef.current || !window.YT?.Player) return;

    const instance = new window.YT.Player(containerRef.current, {
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
          playerRef.current = instance;
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
            if (latest.current.activated && state.status === "PLAYING") {
              instance.playVideo();
            }
          }
        },
        onStateChange: ({ data }) => {
          const state = latest.current.media;
          const videoData = instance.getVideoData?.();
          if (state.current && videoData?.title?.trim()) {
            setMetaMap((prev) => ({
              ...prev,
              [state.current!.video_id]: {
                title: videoData.title,
                channel: videoData.author || prev[state.current!.video_id]?.channel || "YouTube",
              },
            }));
          }

          if (instance.getDuration) {
            const dur = instance.getDuration();
            if (dur > 0) setDuration(dur);
          }

          // Cued and ready to play
          if (data === 5 && state.status === "PLAYING" && latest.current.activated) {
            instance.playVideo();
          }

          // The room authority advances at the canonical end time.
        },
        onError: () => {
          useMusicStore
            .getState()
            .setError("This YouTube video cannot play here. The host can skip it.");
        },
      },
    });

    return () => {
      playerRef.current = null;
      try {
        instance.destroy();
      } catch {}
      loadedVideo.current = null;
    };
  }, [apiReady]);

  // Synchronize playback state with authoritative room updates
  useEffect(() => {
    const instance = playerRef.current;
    if (!instance) return;

    if (!media.current) {
      if (loadedVideo.current) instance.stopVideo();
      loadedVideo.current = null;
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
      instance.playVideo();
    } else {
      instance.pauseVideo();
    }
  }, [media, clockOffset, activated]);

  // High-frequency continuous timer for smooth progress updates
  useEffect(() => {
    const interval = setInterval(() => {
      const instance = playerRef.current;
      const state = latest.current;
      if (!instance || !state.media.current) return;

      if (!isScrubbing) {
        if (state.media.status === "PLAYING") {
          const currentPosSec =
            canonicalPositionMs(
              state.media.position_ms,
              state.media.started_at,
              state.media.status,
              Date.now() + state.clockOffset,
            ) / 1000;
          setCurrentTime(currentPosSec);
        } else {
          setCurrentTime(state.media.position_ms / 1000);
        }
      }

      if (instance.getDuration) {
        const d = instance.getDuration();
        if (d > 0 && d !== duration) setDuration(d);
        if (d > 0 && state.canControl && state.media.current) {
          const seconds = Math.ceil(d);
          const reportKey = `${state.media.current.id}:${state.media.version}:${seconds}`;
          if (state.media.current.duration_sec !== seconds && pendingVersion.current === null &&
            (durationReport.current?.key !== reportKey || Date.now() - durationReport.current.at > 10_000)) {
            if (state.sendCommand("media.duration", {
              expected_version: state.media.version,
              video_id: state.media.current.video_id,
              duration_sec: seconds,
            })) durationReport.current = { key: reportKey, at: Date.now() };
          }
        }
      }
    }, 250);

    return () => clearInterval(interval);
  }, [duration, isScrubbing]);

  // Periodic resync check
  useEffect(() => {
    const resyncTimer = setInterval(() => {
      const instance = playerRef.current;
      const state = latest.current;
      if (!instance || !state.media.current || !state.activated) return;

      const playerState = instance.getPlayerState();
      if (state.media.status !== "PLAYING") {
        if (playerState === 1) instance.pauseVideo();
        return;
      }

      if (playerState === 2 || playerState === 5) {
        instance.playVideo();
        return;
      }

      if (playerState === 1) {
        const target =
          canonicalPositionMs(
            state.media.position_ms,
            state.media.started_at,
            state.media.status,
            Date.now() + state.clockOffset,
          ) / 1000;
        if (Math.abs(instance.getCurrentTime() - target) > 1.5) {
          instance.seekTo(target, true);
        }
      }
    }, 2000);

    return () => clearInterval(resyncTimer);
  }, []);

  const handleAddTrack = async (event: FormEvent) => {
    event.preventDefault();
    if (!available || !url.trim() || isAdding) return;

    setIsAdding(true);
    const trimmed = url.trim();

    // Fetch video metadata first if possible
    let metaTitle = "";
    let metaChannel = "";
    try {
      const match = trimmed.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        const vid = match[1];
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`);
        if (res.ok) {
          const data = await res.json();
          metaTitle = data.title || "";
          metaChannel = data.author_name || "";
        }
      }
    } catch {}

    const sent = session.sendCommand("queue.add", {
      url: trimmed,
      title: metaTitle,
      channel: metaChannel,
    });

    if (sent) setUrl("");
    setIsAdding(false);
  };

  const control = (
    type:
      | "media.play"
      | "media.pause"
      | "queue.next"
      | "media.seek"
      | "queue.select"
      | "queue.remove"
      | "queue.clear"
      | "queue.shuffle"
      | "queue.reorder"
      | "media.repeat",
    payload?: Record<string, unknown>,
  ) => {
    if ((type.startsWith("media.") || type === "queue.next" || type === "queue.select") && !canControl) return;
    if (pendingVersion.current === media.version) return;
    if (type === "media.play" || type === "queue.next" || type === "queue.select") {
      setActivated(true);
    }

    if (
      session.sendCommand(type, {
        expected_version: media.version,
        ...payload,
      })
    ) {
      pendingVersion.current = media.version;
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${index}`);
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const updated = [...media.queue];
    const [movedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, movedItem);
    const order = updated.map((t) => t.id);
    control("queue.reorder", { order });
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleSeekCommit = (newSec: number) => {
    setIsScrubbing(false);
    setCurrentTime(newSec);
    control("media.seek", { position_ms: Math.round(newSec * 1000) });
  };

  const toggleMute = () => {
    if (!playerRef.current) return;
    if (isMuted) {
      playerRef.current.unMute?.();
      playerRef.current.setVolume(volume);
      setIsMuted(false);
    } else {
      playerRef.current.mute?.();
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (playerRef.current) {
      playerRef.current.setVolume(newVol);
      if (isMuted && newVol > 0) {
        playerRef.current.unMute?.();
        setIsMuted(false);
      }
    }
  };

  const toggleFullscreen = () => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const currentMeta = media.current
    ? metaMap[media.current.video_id]
    : null;
  const activeTitle =
    currentMeta?.title ||
    media.current?.title ||
    (media.current ? `YouTube Video (${media.current.video_id})` : "");
  const activeChannel =
    currentMeta?.channel || media.current?.channel || "YouTube";

  const effectiveDuration = duration > 0 ? duration : media.current?.duration_sec || 0;
  const displayCurrentTime = currentTime;
  const progressPercent =
    effectiveDuration > 0
      ? Math.min(100, (displayCurrentTime / effectiveDuration) * 100)
      : 0;

  const totalTracksCount = (media.current ? 1 : 0) + media.queue.length;

  return (
    <aside
      aria-label={mq.sharedQueue}
      aria-hidden={!open}
      className={`fixed top-14 right-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-0 w-full md:w-96 z-40 bg-[var(--bg-loft-card)] border-l border-[var(--border-loft)] shadow-2xl flex flex-col transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
    >
      {/* Header Bar */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm text-[var(--text-loft-primary)]">
            {mq.sharedQueue}
          </h3>
          <span className="px-2 py-0.5 rounded-full bg-[#0066CC]/15 text-[#0066CC] text-[11px] font-semibold">
            {totalTracksCount}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Script for YouTube IFrame API */}
      <Script
        src="https://www.youtube.com/iframe_api"
        strategy="afterInteractive"
        onReady={() => {
          if (window.YT?.Player) setApiReady(true);
        }}
      />

      {/* Drawer Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 text-left">
        {/* Quick Add Input Bar */}
        <form onSubmit={handleAddTrack} className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-loft-muted)]" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={mq.pasteUrl}
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] text-xs text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] focus:outline-none focus:border-[#0066CC] transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={!available || !url.trim() || isAdding}
            className="h-9 px-3.5 rounded-xl bg-[#0066CC] hover:bg-[#0077ED] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAdding ? mq.adding : mq.add}</span>
          </button>
        </form>

        {error && (
          <div className="px-3 py-2 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20 text-[#FF3B30] text-xs">
            {error}
          </div>
        )}

        {/* ---------------- 1. NOW PLAYING COMPACT CARD ---------------- */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-loft-muted)] flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  media.status === "PLAYING"
                    ? "bg-[#0066CC] shadow-[0_0_6px_#0066CC] animate-pulse"
                    : "bg-[var(--text-loft-muted)]"
                }`}
              />
              {mq.nowPlaying}
            </span>
            {media.current && (
              <span className="text-[10px] font-medium text-[var(--text-loft-muted)]">
                {media.status === "PLAYING" ? "LIVE" : "PAUSED"}
              </span>
            )}
          </div>

          <div className="rounded-2xl bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] shadow-md overflow-hidden p-3 flex flex-col gap-2.5">
            {/* 16:9 Video Canvas Viewport */}
            <div className="relative w-full aspect-video max-h-[190px] rounded-xl overflow-hidden bg-black border border-white/5 shadow-inner">
              <div ref={containerRef} className="w-full h-full" />
              {!media.current && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500 bg-zinc-950/80">
                  <Music className="w-8 h-8 opacity-40" />
                  <span className="text-xs">{mq.noMedia}</span>
                </div>
              )}
            </div>

            {/* Title & Channel Metadata */}
            {media.current ? (
              <div className="flex flex-col min-w-0">
                <span
                  className="font-semibold text-sm text-[var(--text-loft-primary)] truncate"
                  title={activeTitle}
                >
                  {activeTitle}
                </span>
                <span className="text-xs text-[var(--text-loft-secondary)] truncate">
                  {activeChannel} · YouTube
                </span>
              </div>
            ) : (
              <span className="text-xs text-[var(--text-loft-muted)]">
                {mq.noMedia}
              </span>
            )}

            {/* Audio Enable Prompt if not yet activated on mobile/Safari */}
            {media.current && !activated && (
              <button
                onClick={() => setActivated(true)}
                className="w-full py-1.5 rounded-lg bg-[#0066CC] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-xs transition-all"
              >
                {mq.enableAudio}
              </button>
            )}

            {/* Progress Scrubber Bar */}
            {media.current && (
              <div className="flex flex-col gap-1 pt-1">
                <div
                  className={`relative w-full h-2 flex items-center group ${canControl ? "cursor-pointer" : "cursor-default"}`}
                  onClick={(e) => {
                    if (!canControl) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickPct = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width),
                    );
                    if (effectiveDuration > 0) {
                      handleSeekCommit(clickPct * effectiveDuration);
                    }
                  }}
                >
                  <div className="w-full h-1 bg-[var(--border-loft)] group-hover:h-1.5 rounded-full overflow-hidden transition-all">
                    <div
                      className="h-full bg-[#0066CC] rounded-full transition-all duration-100"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  {/* Scrubber thumb */}
                  <div
                    className="absolute w-3 h-3 rounded-full bg-white shadow-md -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ left: `${progressPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-loft-muted)] px-0.5">
                  <span>{formatTime(displayCurrentTime)}</span>
                  <span>{formatTime(effectiveDuration)}</span>
                </div>
              </div>
            )}

            {/* Compact Control Button Toolbar */}
            {media.current && (
              <div className="flex items-center justify-between pt-1 border-t border-[var(--border-loft)]">
                <div className="flex items-center gap-1.5">
                  {/* Previous / Restart */}
                  <button
                    onClick={() => control("media.seek", { position_ms: 0 })}
                    disabled={!canControl}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-all cursor-pointer"
                    title={mq.previous}
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  {/* Play / Pause Primary Action */}
                  <button
                    onClick={() =>
                      control(
                        media.status === "PLAYING"
                          ? "media.pause"
                          : "media.play",
                      )
                    }
                    disabled={!canControl}
                    className="w-9 h-9 rounded-xl bg-[#0066CC] hover:bg-[#0077ED] text-white flex items-center justify-center shadow-sm active:scale-95 transition-all cursor-pointer"
                    title={
                      media.status === "PLAYING" ? mq.pause : mq.play
                    }
                  >
                    {media.status === "PLAYING" ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  {/* Next Track */}
                  <button
                    onClick={() => control("queue.next")}
                    disabled={!canControl}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-all cursor-pointer"
                    title={mq.next}
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Secondary Actions: Volume, Fullscreen, External */}
                <div className="flex items-center gap-1 relative">
                  {/* Volume Toggle & Popover */}
                  <div
                    className="relative flex items-center"
                    onMouseEnter={() => setShowVolumeSlider(true)}
                    onMouseLeave={() => setShowVolumeSlider(false)}
                  >
                    <button
                      onClick={toggleMute}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-all cursor-pointer"
                      title={mq.volume}
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="w-4 h-4 text-[#FF3B30]" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>

                    {/* Inline mini slider when hovered */}
                    {showVolumeSlider && (
                      <div className="absolute right-0 bottom-full mb-1 p-2 rounded-xl bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-xl z-50 flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={isMuted ? 0 : volume}
                          onChange={(e) =>
                            handleVolumeChange(Number(e.target.value))
                          }
                          className="w-20 accent-[#0066CC] cursor-pointer"
                        />
                        <span className="text-[10px] font-mono w-6 text-right">
                          {isMuted ? 0 : volume}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Fullscreen Video */}
                  <button
                    onClick={toggleFullscreen}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-all cursor-pointer"
                    title={mq.fullscreen}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Open in YouTube */}
                  <a
                    href={`https://www.youtube.com/watch?v=${media.current.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[#0066CC] hover:bg-[var(--border-loft)] transition-all"
                    title={mq.openInYouTube}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------------- 2. NEXT UP QUEUE SECTION ---------------- */}
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-loft-muted)]">
              {mq.nextUp} ({media.queue.length})
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
            {media.queue.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--text-loft-muted)] rounded-2xl border border-dashed border-[var(--border-loft)] flex flex-col items-center justify-center gap-1">
                <span>{mq.emptyQueue}</span>
              </div>
            ) : (
              media.queue.map((track, idx) => {
                const itemMeta = metaMap[track.video_id];
                const trackTitle =
                  itemMeta?.title ||
                  track.title ||
                  `YouTube Video (${track.video_id})`;
                const trackChannel =
                  itemMeta?.channel || track.channel || "YouTube";

                const isDragging = draggedIndex === idx;
                const isOver = dragOverIndex === idx && draggedIndex !== idx;

                return (
                  <div
                    key={track.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`group flex items-center gap-2.5 p-2 rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none ${
                      isDragging
                        ? "opacity-30 bg-[var(--border-loft)]/40 border-dashed border-[var(--border-loft)] scale-[0.98]"
                        : isOver
                          ? "bg-[#0066CC]/15 border-[#0066CC] ring-1 ring-[#0066CC]/40"
                          : "bg-[var(--bg-loft-surface)]/60 hover:bg-[var(--border-loft)] border-transparent hover:border-[var(--border-loft)]"
                    }`}
                  >
                    {/* Drag Handle */}
                    <div
                      className="text-[var(--text-loft-muted)] opacity-50 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing"
                      title="Kéo để sắp xếp lại danh sách"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    {/* 16:9 Mini Thumbnail */}
                    <div className="relative w-14 h-9 rounded-lg overflow-hidden bg-black shrink-0 border border-white/5">
                      <img
                        src={`https://img.youtube.com/vi/${track.video_id}/mqdefault.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-0.5 right-1 text-[9px] font-mono text-white/80 bg-black/60 px-1 rounded">
                        #{idx + 1}
                      </span>
                    </div>

                    {/* Track Info */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className="text-xs font-semibold text-[var(--text-loft-primary)] truncate"
                        title={trackTitle}
                      >
                        {trackTitle}
                      </span>
                      <span className="text-[11px] text-[var(--text-loft-secondary)] truncate">
                        {trackChannel} · {mq.addedBy} {track.added_by}
                      </span>
                    </div>

                    {/* Quick Item Actions: Play / Select and Remove */}
                    <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Play Immediately */}
                      <button
                        onClick={() =>
                          control("queue.select", { track_id: track.id })
                        }
                        disabled={!canControl}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[#0066CC] hover:bg-[var(--bg-loft-card)] transition-colors cursor-pointer"
                        title={mq.play}
                      >
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      </button>

                      {/* Remove from Queue */}
                      <button
                        onClick={() =>
                          control("queue.remove", { track_id: track.id })
                        }
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[#FF3B30] hover:bg-[var(--bg-loft-card)] transition-colors cursor-pointer"
                        title={mq.remove}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ---------------- 3. BOTTOM TOOLBAR ---------------- */}
        <div className="pt-2 border-t border-[var(--border-loft)] flex items-center justify-between text-xs text-[var(--text-loft-secondary)]">
          <div className="flex items-center gap-1.5">
            {/* Shuffle */}
            <button
              onClick={() => control("queue.shuffle")}
              disabled={media.queue.length <= 1}
              className="px-2.5 py-1 rounded-lg hover:bg-[var(--border-loft)] disabled:opacity-40 flex items-center gap-1.5 transition-colors cursor-pointer"
              title={mq.shuffle}
            >
              <Shuffle className="w-3.5 h-3.5 text-[#0066CC]" />
              <span>{mq.shuffle}</span>
            </button>

            {/* Repeat */}
          <button
              onClick={() => control("media.repeat", { repeat: !media.repeat })}
              disabled={!canControl}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                media.repeat
                  ? "bg-[#0066CC]/15 text-[#0066CC] font-semibold"
                  : "hover:bg-[var(--border-loft)]"
              }`}
              title={mq.repeat}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>{mq.repeat}</span>
            </button>
          </div>

          {/* Clear List */}
          <button
            onClick={() => control("queue.clear")}
            disabled={media.queue.length === 0}
            className="px-2.5 py-1 rounded-lg hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] disabled:opacity-40 flex items-center gap-1.5 transition-colors cursor-pointer"
            title={mq.clearList}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{mq.clearList}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
