"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoTrack, type TrackReference } from "@livekit/components-react";
import {
  Maximize2,
  Minimize2,
  PanelBottomClose,
  PanelBottomOpen,
} from "lucide-react";
import { useUIText } from "@/lib/i18n/uiText";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};
type IOSVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Shared-screen viewport with a real fullscreen mode and a "focus" toggle
 * that hands the participant strip's height back to the shared screen.
 * Growing the element also lets LiveKit's adaptiveStream pick a sharper layer.
 */
export function ScreenShareViewport({
  track,
  stripHidden,
  onToggleStrip,
}: {
  track: TrackReference;
  stripHidden: boolean;
  onToggleStrip: () => void;
}) {
  const tr = useUIText();
  const viewport = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () =>
      setIsFullscreen(
        Boolean(viewport.current) && fullscreenElement() === viewport.current,
      );
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = viewport.current as FullscreenElement | null;
    if (!element) return;
    const doc = document as FullscreenDocument;
    if (fullscreenElement()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (element.requestFullscreen) {
      void element.requestFullscreen().catch(() => {});
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else {
      // iPhone Safari only allows <video> itself to enter fullscreen.
      (element.querySelector("video") as IOSVideo | null)?.webkitEnterFullscreen?.();
    }
  }, []);

  const fullscreenLabel = isFullscreen ? tr("Exit full screen") : tr("Full screen");
  const stripLabel = stripHidden ? tr("Show participants") : tr("Hide participants");
  const button =
    "grid h-9 w-9 place-items-center rounded-[8px] bg-[#101113]/75 text-white backdrop-blur transition hover:bg-[#101113] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div
      ref={viewport}
      data-testid="screen-share-viewport"
      className="group relative min-h-0 min-w-0 overflow-hidden rounded-[10px] bg-[#101113] shadow-2xl"
      onDoubleClick={toggleFullscreen}
    >
      <VideoTrack
        trackRef={track}
        className="h-full w-full object-contain"
        style={{ objectFit: "contain" }}
      />
      <div className="absolute bottom-3 left-3 rounded-[5px] bg-[#101113]/80 px-2 py-1 text-[13px] text-white">
        {track.participant.name || track.participant.identity} {tr("is sharing")}
      </div>
      <div className="absolute right-3 top-3 flex gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {!isFullscreen && (
          <button
            type="button"
            className={button}
            onClick={onToggleStrip}
            aria-pressed={stripHidden}
            aria-label={stripLabel}
            title={stripLabel}
          >
            {stripHidden ? <PanelBottomOpen size={18} /> : <PanelBottomClose size={18} />}
          </button>
        )}
        <button
          type="button"
          className={button}
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
    </div>
  );
}
