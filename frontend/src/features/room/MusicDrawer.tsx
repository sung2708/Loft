"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { useMusicPlayerStore } from "@/stores/useMusicPlayerStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { useRoomSession } from "./RoomSession";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { SpotifyPanel } from "./SpotifyPanel";
import { YouTubeRoomPicks } from "./YouTubeRoomPicks";
import { useAuth } from "@/lib/auth/useAuth";
import { API_URL } from "@/lib/config";
import { useMobileDrawerFocus } from "./useMobileDrawerFocus";

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function MusicDrawer({
  open,
  onClose,
  onPlayerSurfaceReady,
}: {
  open: boolean;
  onClose: () => void;
  onPlayerSurfaceReady: (surface: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation();
  const { session: authSession } = useAuth();
  const mq = t.mediaQueue;

  const media = useMusicStore((state) => state.media ?? emptyMedia);
  const available = useMusicStore((state) => state.available);
  const error = useMusicStore((state) => state.error);
  const self = useRoomStore((state) => state.self);
  const room = useRoomStore((state) => state.room);
  const session = useRoomSession();
  const activated = useMusicPlayerStore((state) => state.activated);
  const volume = useMusicPlayerStore((state) => state.volume);
  const playerReady = useMusicPlayerStore((state) => state.playerReady);
  const duration = useMusicPlayerStore((state) => state.duration);
  const currentTime = useMusicPlayerStore((state) => state.currentTime);
  const setVolume = useMusicPlayerStore((state) => state.setVolume);
  const requestAudioActivation = useMusicPlayerStore(
    (state) => state.requestAudioActivation,
  );

  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [musicTab, setMusicTab] = useState<"queue" | "spotify">("queue");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ video_id: string; title: string; channel: string; thumbnail?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults([]);
      setSearching(false);
      setSearched(false);
    }
  };

  const [metaMap, setMetaMap] = useState<
    Record<string, { title?: string; channel?: string }>
  >({});

  const volumeRef = useRef<HTMLDivElement>(null);
  const playerSurfaceRef = useRef<HTMLDivElement>(null);
  const pendingVersion = useRef<number | null>(null);
  const metadataFetching = useRef(new Set<string>());
  const { closeButtonRef, isModal, panelRef } = useMobileDrawerFocus(open);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || !authSession?.access_token) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      fetch(`${API_URL}/api/v1/youtube/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${authSession.access_token}` },
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!controller.signal.aborted) {
            setSearchResults(payload?.items ?? []);
            setSearched(true);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setSearchResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearching(false);
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, authSession?.access_token]);

  const canControl = Boolean(
    self?.identity_type === "user" && room?.owner_id === self.identity_id,
  );
  const setPlayerSurface = useCallback(
    (surface: HTMLDivElement | null) => {
      playerSurfaceRef.current = surface;
      onPlayerSurfaceReady(surface);
    },
    [onPlayerSurfaceReady],
  );

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

  const addTrackUrl = async (rawUrl: string, playNow = false) => {
    if (!available || !rawUrl.trim() || isAdding) return;
    setIsAdding(true);
    const trimmed = rawUrl.trim();

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

    const sent = session.sendCommand(playNow ? "media.play_now" : "queue.add", {
      url: trimmed,
      title: metaTitle,
      channel: metaChannel,
    });

    if (sent) {
      setUrl("");
      setSearchQuery("");
      setSearchResults([]);
      setSearched(false);
    }
    setIsAdding(false);
  };

  const handleAddTrack = async (event: FormEvent) => {
    event.preventDefault();
    await addTrackUrl(url);
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
      requestAudioActivation();
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
    control("media.seek", { position_ms: Math.round(newSec * 1000) });
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  useEffect(() => () => onPlayerSurfaceReady(null), [onPlayerSurfaceReady]);

  useEffect(() => {
    if (!showVolumeSlider) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!volumeRef.current?.contains(event.target as Node)) {
        setShowVolumeSlider(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowVolumeSlider(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showVolumeSlider]);

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (newVol > 0) requestAudioActivation();
  };

  const toggleFullscreen = () => {
    const el = playerSurfaceRef.current?.parentElement;
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
      ref={panelRef}
      role="dialog"
      aria-modal={isModal || undefined}
      aria-label={mq.sharedQueue}
      aria-hidden={!open}
      inert={!open}
      className={`fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-0 top-14 z-40 flex w-full flex-col border-l border-[var(--border-loft)] bg-[var(--bg-loft-card)] shadow-2xl transition-opacity duration-150 md:bottom-auto md:right-auto md:top-auto md:z-auto md:col-start-2 md:h-full md:w-96 md:shrink-0 ${
        open
          ? "opacity-100"
          : "invisible pointer-events-none opacity-0 md:absolute md:inset-y-0 md:right-0 md:w-96"
      }`}
    >
      {/* Header Bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-[11px] text-[var(--text-loft-primary)]">
            {mq.sharedQueue}
          </h3>
          <span className="rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-2 py-1 text-[11px] font-medium text-[var(--text-loft-primary)]">
            {totalTracksCount}
          </span>
        </div>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label={t.common.close}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-loft-secondary)] hover-invert hover:text-[var(--text-loft-primary)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-2" role="tablist" aria-label={mq.sharedQueue}>
        <button type="button" role="tab" aria-selected={musicTab === "queue"} onClick={() => setMusicTab("queue")} className={`btn-press flex-1 rounded-[5px] px-2 py-2 text-[11px] font-medium ${musicTab === "queue" ? "bg-[#101113] text-white shadow-sm" : "text-[var(--text-loft-secondary)] hover-invert"}`}>{mq.sharedQueue}</button>
        <button type="button" role="tab" aria-selected={musicTab === "spotify"} onClick={() => setMusicTab("spotify")} className={`btn-press flex-1 rounded-[5px] px-2 py-2 text-[11px] font-medium ${musicTab === "spotify" ? "bg-[#101113] text-white shadow-sm" : "text-[var(--text-loft-secondary)] hover-invert"}`}>Spotify</button>
      </div>
      {musicTab === "spotify" && <SpotifyPanel />}

      {/* Drawer Body */}
      <div role="tabpanel" className={`${musicTab === "spotify" ? "hidden" : ""} flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-left`}>
        {/* Quick Add Input Bar */}
        <form onSubmit={handleAddTrack} className="flex items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-2 shadow-sm">
          <div className="relative flex-1 min-w-0">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-loft-muted)]" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={mq.pasteUrl}
              className="h-9 w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] pl-10 pr-3 text-[11px] text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] outline-none focus:border-[var(--accent-blue)]"
            />
          </div>
          <button
            type="submit"
            disabled={!available || !url.trim() || isAdding}
            className="btn-press flex h-9 items-center gap-2 rounded-[6px] bg-[#101113] px-4 text-[11px] font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAdding ? mq.adding : mq.add}</span>
          </button>
        </form>

        {canControl && (
          <label className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 py-2 text-[11px] shadow-sm">
            <span><span className="block font-medium">Autoplay</span><span className="text-[10px] text-[var(--text-loft-secondary)]">Continue with room suggestions when the queue ends</span></span>
            <input type="checkbox" checked={media.autoplay ?? false} onChange={(event) => session.sendCommand("media.autoplay.set", { autoplay: event.target.checked, expected_version: media.version })} className="h-4 w-4 accent-[var(--accent-blue)]" />
          </label>
        )}

        <div className="rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 shadow-sm">
          <input
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search YouTube"
            className="h-9 w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 text-[11px] text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] outline-none focus:border-[var(--accent-blue)]"
            aria-label="Search YouTube"
          />
          {searching && (
            <p className="mt-2 text-[10px] text-[var(--text-loft-secondary)]">
              Searching…
            </p>
          )}
          {!searching && searched && searchQuery.trim() && searchResults.length === 0 && (
            <p className="mt-2 text-[10px] text-[var(--text-loft-secondary)]">
              No YouTube results.
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1">
              {searchResults.map((result) => (
                <div
                  key={result.video_id}
                  className="flex items-center gap-2 rounded-[5px] border border-transparent p-2 transition-colors hover:border-[var(--border-loft)] hover:bg-[var(--bg-loft-card)]"
                >
                  {result.thumbnail && (
                    <img
                      src={result.thumbnail}
                      alt=""
                      className="h-9 w-12 shrink-0 rounded object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    {result.title}
                    <span className="block truncate text-[10px] text-[var(--text-loft-secondary)]">
                      {result.channel}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        session.sendCommand("youtube.pick.create", {
                          video_id: result.video_id,
                          title: result.title,
                          channel: result.channel,
                        })
                      }
                      className="rounded border border-[var(--border-loft)] px-2 py-1 text-[10px] hover-invert"
                    >
                      Pick
                    </button>
                    <button
                      type="button"
                      disabled={isAdding || !available}
                      onClick={() =>
                        void addTrackUrl(
                          `https://www.youtube.com/watch?v=${result.video_id}`,
                        )
                      }
                      className="rounded border border-[var(--border-loft)] px-2 py-1 text-[10px] hover-invert disabled:opacity-40"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      disabled={isAdding || !available}
                      onClick={() =>
                        void addTrackUrl(
                          `https://www.youtube.com/watch?v=${result.video_id}`,
                          true,
                        )
                      }
                      className="rounded bg-[var(--accent-blue)] px-2 py-1 text-[10px] text-white disabled:opacity-40"
                    >
                      Play
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 rounded-[6px] bg-[#101113]/10 border border-[var(--border-loft)]/20 text-[var(--text-loft-primary)] text-[11px]">
            {error}
          </div>
        )}
        <YouTubeRoomPicks />

        {/* ---------------- 1. NOW PLAYING COMPACT CARD ---------------- */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)] flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  media.status === "PLAYING"
                    ? "bg-[#101113] shadow-[0_0_6px_#101113] animate-pulse"
                    : "bg-[var(--text-loft-muted)]"
                }`}
              />
              {mq.nowPlaying}
            </span>
            {media.current && (
              <span className="text-[11px] font-medium text-[var(--text-loft-muted)]">
                {media.status === "PLAYING" ? "LIVE" : "PAUSED"}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 overflow-hidden rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 shadow-[6px_6px_0_color-mix(in_srgb,var(--border-loft)_12%,transparent)]">
            {/* 16:9 Video Canvas Viewport */}
            <div className="relative aspect-video w-full max-h-[190px] overflow-hidden rounded-[6px] border border-white/10 bg-[#101113] shadow-inner">
              <div ref={setPlayerSurface} className="w-full h-full" />
              {!media.current && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#101113] text-white/65">
                  <Music className="w-8 h-8 opacity-40" />
                  <span className="text-[11px]">{mq.noMedia}</span>
                </div>
              )}
            </div>

            {/* Title & Channel Metadata */}
            {media.current ? (
              <div className="flex flex-col min-w-0">
                <span
                  className="font-medium text-[11px] text-[var(--text-loft-primary)] truncate"
                  title={activeTitle}
                >
                  {activeTitle}
                </span>
                <span className="text-[11px] text-[var(--text-loft-secondary)] truncate">
                  {activeChannel} · YouTube
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-[var(--text-loft-muted)]">
                {mq.noMedia}
              </span>
            )}

            {/* Audio Enable Prompt if not yet activated on mobile/Safari */}
            {media.current && media.status === "PLAYING" && !activated && (
              <button
                onClick={requestAudioActivation}
                disabled={!playerReady}
                className="btn-press w-full rounded-[6px] bg-[#101113] py-2 text-[11px] font-medium text-white shadow-sm disabled:opacity-50"
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
                  <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-loft)] transition-all group-hover:h-1.5">
                    <div
                      className="h-full rounded-full bg-[var(--accent-blue)] transition-all duration-200"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  {/* Scrubber thumb */}
                  <div
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                    style={{ left: `${progressPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between px-1 text-[11px] font-mono text-[var(--text-loft-muted)]">
                  <span>{formatTime(displayCurrentTime)}</span>
                  <span>{formatTime(effectiveDuration)}</span>
                </div>
              </div>
            )}

            {/* Compact Control Button Toolbar */}
            {media.current && (
              <div className="flex items-center justify-between border-t border-[var(--border-loft)] pt-2">
                <div className="flex items-center gap-2">
                  {/* Previous / Restart */}
                  <button
                    onClick={() => control("media.seek", { position_ms: 0 })}
                    disabled={!canControl}
                    className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-all cursor-pointer"
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
                    className="btn-press flex h-9 w-9 items-center justify-center rounded-[6px] bg-[#101113] text-white shadow-sm disabled:opacity-40"
                    title={
                      media.status === "PLAYING" ? mq.pause : mq.play
                    }
                  >
                    {media.status === "PLAYING" ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-1" />
                    )}
                  </button>

                  {/* Next Track */}
                  <button
                    onClick={() => control("queue.next")}
                    disabled={!canControl}
                    className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-all cursor-pointer"
                    title={mq.next}
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Secondary Actions: Volume, Fullscreen, External */}
                <div className="flex items-center gap-1 relative">
                  {/* Volume Toggle & Popover */}
                  <div
                    ref={volumeRef}
                    className="relative flex items-center"
                    onMouseEnter={() => setShowVolumeSlider(true)}
                    onFocus={() => setShowVolumeSlider(true)}
                  >
                    <button
                      onClick={() => {
                        setShowVolumeSlider(true);
                      }}
                      onMouseEnter={() => setShowVolumeSlider(true)}
                      className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-all cursor-pointer"
                      title={mq.volume}
                      aria-label={mq.volume}
                      aria-expanded={showVolumeSlider}
                    >
                      {volume === 0 ? (
                        <VolumeX className="w-4 h-4 text-[var(--text-loft-primary)]" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>

                    {/* Inline mini slider when hovered */}
                    {showVolumeSlider && (
                      <div role="dialog" aria-label={mq.volume} className="absolute bottom-full right-0 z-50 mb-1 flex items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-2 shadow-xl">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={volume}
                          onChange={(e) =>
                            handleVolumeChange(Number(e.target.value))
                          }
                          className="w-20 accent-[#101113] cursor-pointer"
                        />
                        <span className="text-[11px] font-mono w-6 text-right">
                          {volume}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Fullscreen Video */}
                  <button
                    onClick={toggleFullscreen}
                    className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-all cursor-pointer"
                    title={mq.fullscreen}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Open in YouTube */}
                  <a
                    href={`https://www.youtube.com/watch?v=${media.current.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-all"
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
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
              {mq.nextUp} ({media.queue.length})
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {media.queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-[var(--border-loft)] py-8 text-center text-[11px] text-[var(--text-loft-muted)]">
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
                    className={`group flex items-center gap-3 p-2 rounded-[6px] border transition-all cursor-grab active:cursor-grabbing select-none ${
                      isDragging
                        ? "opacity-30 bg-[var(--border-loft)]/40 border-dashed border-[var(--border-loft)] scale-[0.98]"
                        : isOver
                          ? "bg-[#101113]/15 border-[var(--border-loft)] ring-1 ring-[var(--accent-blue)]/40"
                          : "bg-[var(--bg-loft-surface)]/60 hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] border-transparent hover:border-[var(--border-loft)]"
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
                    <div className="relative h-9 w-14 shrink-0 overflow-hidden rounded-[6px] border border-white/10 bg-[#101113]">
                      <img
                        src={`https://img.youtube.com/vi/${track.video_id}/mqdefault.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-1 right-1 text-[11px] font-mono text-white/80 bg-[#101113]/60 px-1 rounded-[6px]">
                        #{idx + 1}
                      </span>
                    </div>

                    {/* Track Info */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className="text-[11px] font-medium text-[var(--text-loft-primary)] truncate"
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
                        className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--bg-loft-card)] transition-colors cursor-pointer"
                        title={mq.play}
                      >
                        <Play className="w-3 h-3 fill-current ml-1" />
                      </button>

                      {/* Remove from Queue */}
                      <button
                        onClick={() =>
                          control("queue.remove", { track_id: track.id })
                        }
                        className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--bg-loft-card)] transition-colors cursor-pointer"
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-loft)] pt-2 text-[11px] text-[var(--text-loft-secondary)]">
          <div className="flex items-center gap-2">
            {/* Shuffle */}
            <button
              onClick={() => control("queue.shuffle")}
              disabled={media.queue.length <= 1}
              className="px-3 py-1 rounded-[6px] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] disabled:opacity-40 flex items-center gap-2 transition-colors cursor-pointer"
              title={mq.shuffle}
            >
              <Shuffle className="w-3.5 h-3.5 text-[var(--text-loft-primary)]" />
              <span>{mq.shuffle}</span>
            </button>

            {/* Repeat */}
          <button
              onClick={() => control("media.repeat", { repeat: !media.repeat })}
              disabled={!canControl}
              className={`px-3 py-1 rounded-[6px] flex items-center gap-2 transition-colors cursor-pointer ${
                media.repeat
                  ? "bg-[#101113]/15 text-[var(--text-loft-primary)] font-medium"
                  : "hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)]"
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
            className="px-3 py-1 rounded-[6px] hover:bg-[#101113]/10 hover:text-[var(--text-loft-primary)] disabled:opacity-40 flex items-center gap-2 transition-colors cursor-pointer"
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
