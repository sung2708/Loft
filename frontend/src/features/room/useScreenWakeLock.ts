"use client";

import { useEffect } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
};
type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinelLike> };

/**
 * Keeps the screen awake during a call (phones otherwise dim and lock during
 * audio-only calls or while watching a share). Browsers drop the lock when
 * the tab is hidden, so it is re-requested whenever the tab becomes visible.
 */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const next = await wakeLock.request("screen");
        if (disposed) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        // Denied (battery saver, unsupported context): the call works without it.
      }
    };
    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
