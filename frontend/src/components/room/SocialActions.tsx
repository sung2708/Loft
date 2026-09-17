"use client";

import { Hand, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUIText } from "@/lib/i18n/uiText";

const reactions = ["❤️", "😂", "🔥", "👏", "😭"] as const;

export function SocialActions({
  raised,
  disabled = false,
  onReaction,
  onWave,
  onToggleHand,
  controlClass,
}: {
  raised: boolean;
  disabled?: boolean;
  onReaction: (emoji: string) => void;
  onWave: () => void;
  onToggleHand: () => void;
  controlClass: string;
}) {
  const tr = useUIText();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const act = (action: () => void) => {
    action();
    close(true);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={controlClass}
        title={tr("Reactions")}
        aria-label={tr("Social actions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SmilePlus className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={tr("Social actions")}
          className="absolute bottom-full right-0 mb-3 flex max-w-[calc(100vw-1rem)] gap-1 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-2 shadow-xl motion-reduce:transform-none sm:[transform:perspective(900px)_rotateX(2deg)]"
        >
          {reactions.map((emoji) => (
            <button
              type="button"
              role="menuitem"
              key={emoji}
              onClick={() => act(() => onReaction(emoji))}
              aria-label={`${tr("React")} ${emoji}`}
              className="h-8 w-8 shrink-0 rounded-full text-[11px] hover-invert active:scale-110 motion-reduce:transition-none"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => act(onWave)} aria-label={tr("Wave to the room")} className="h-8 w-8 shrink-0 rounded-full text-[11px] hover-invert">
            <span aria-hidden="true">👋</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={raised} onClick={() => act(onToggleHand)} aria-label={tr(raised ? "Lower hand" : "Raise hand")} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover-invert ${raised ? "bg-[var(--border-loft-light)]" : ""}`}>
            <Hand className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
