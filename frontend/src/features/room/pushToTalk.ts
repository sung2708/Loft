"use client";

import { useEffect, useRef } from "react";

export const PUSH_TO_TALK_CODE = "Space";
/** Short tail so the last syllable is not clipped on release. */
export const PUSH_TO_TALK_RELEASE_MS = 200;

/**
 * True when keyboard focus is somewhere typing a space is meaningful.
 * Buttons are deliberately not listed: after clicking a dock control focus
 * stays on it, and Space must still talk instead of re-pressing that button.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="slider"]',
    ),
  );
}

export function isPushToTalkKey(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "target">,
): boolean {
  if (event.code !== PUSH_TO_TALK_CODE) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !isEditableTarget(event.target);
}

/**
 * Serializes async mic toggles so rapid press/release never interleaves two
 * LiveKit calls; only the latest desired state is applied after the current
 * call settles.
 */
export function createLatestApplier(apply: (enabled: boolean) => Promise<void>) {
  let desired: boolean | null = null;
  let running = false;
  let applied: boolean | null = null;
  const drain = async () => {
    running = true;
    try {
      while (desired !== null && desired !== applied) {
        const target = desired;
        try {
          await apply(target);
          applied = target;
        } catch {
          // Leave applied unchanged; a later press retries.
          desired = null;
        }
      }
    } finally {
      running = false;
    }
  };
  return {
    set(enabled: boolean, current: boolean) {
      if (!running) applied = current;
      desired = enabled;
      if (!running) void drain();
    },
  };
}

/**
 * Hold Space to talk. Releasing only mutes if this hook unmuted, so a mic the
 * user turned on with the dock button stays on.
 */
export function usePushToTalk({
  enabled,
  micEnabled,
  setMic,
}: {
  enabled: boolean;
  micEnabled: boolean;
  setMic: (enabled: boolean) => Promise<void>;
}) {
  const micRef = useRef(micEnabled);
  const setMicRef = useRef(setMic);
  useEffect(() => {
    micRef.current = micEnabled;
    setMicRef.current = setMic;
  });

  useEffect(() => {
    if (!enabled) return;
    const applier = createLatestApplier((next) => setMicRef.current(next));
    let holding = false;
    let unmutedByKey = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    const press = (event: KeyboardEvent) => {
      if (!isPushToTalkKey(event)) return;
      event.preventDefault();
      if (event.repeat || holding) return;
      holding = true;
      clearTimeout(releaseTimer);
      if (!micRef.current || unmutedByKey) {
        unmutedByKey = true;
        applier.set(true, micRef.current);
      }
    };
    const release = () => {
      if (!holding) return;
      holding = false;
      if (!unmutedByKey) return;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        unmutedByKey = false;
        applier.set(false, micRef.current);
      }, PUSH_TO_TALK_RELEASE_MS);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== PUSH_TO_TALK_CODE) return;
      // Buttons activate on Space keyup; swallow it while talking.
      if (holding) event.preventDefault();
      release();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") release();
    };

    window.addEventListener("keydown", press);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", press);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onHidden);
      clearTimeout(releaseTimer);
      if (unmutedByKey) applier.set(false, micRef.current);
    };
  }, [enabled]);
}
