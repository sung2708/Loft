"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useRoomStore } from "@/stores/useRoomStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { useUIStore } from "@/stores/useUIStore";
import { deriveAdaptivePalette, type AdaptivePalette } from "./atmosphere/adaptivePalette";
import { atmosphereCapabilities, shouldUseAdaptiveTreatment } from "./atmosphere/degradation";

export function RoomAtmosphere({ children, screenShare = false }: { children: ReactNode; screenShare?: boolean }) {
  const room = useRoomStore((state) => state.room);
  const preview = useUIStore((state) => state.roomAppearancePreview);
  const videoId = useMusicStore((state) => state.media.current?.video_id ?? null);
  const [derived, setDerived] = useState<{ videoId: string; palette: AdaptivePalette | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const capabilities = atmosphereCapabilities();
    if (!(preview?.adaptiveMediaBackground ?? room?.adaptive_media_background) || !videoId || screenShare || !shouldUseAdaptiveTreatment(capabilities)) {
      return () => controller.abort();
    }
    void deriveAdaptivePalette(videoId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setDerived({ videoId, palette: value });
    });
    return () => controller.abort();
  }, [preview?.adaptiveMediaBackground, room?.adaptive_media_background, screenShare, videoId]);

  const adaptiveMediaBackground = preview?.adaptiveMediaBackground ?? room?.adaptive_media_background ?? true;
  const atmosphere = preview?.atmosphere ?? room?.atmosphere ?? "ambient";
  const accent = preview?.accent ?? room?.accent ?? "blue";
  const palette = adaptiveMediaBackground && !screenShare && derived?.videoId === videoId ? derived.palette : null;
  const style = palette ? ({ "--room-media-primary": palette.primary, "--room-media-secondary": palette.secondary } as CSSProperties) : undefined;
  return <div className="room-atmosphere relative h-full w-full" data-atmosphere={atmosphere} data-accent={accent} data-preview={preview ? "true" : "false"} data-adaptive={palette ? "ready" : "fallback"} data-screen-share={screenShare ? "true" : "false"} style={style}>
    <div aria-hidden="true" className="room-atmosphere__backdrop absolute inset-0 pointer-events-none" />
    <div className="relative h-full w-full">{children}</div>
  </div>;
}
