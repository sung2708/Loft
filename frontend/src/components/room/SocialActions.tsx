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
          className="absolute bottom-full right-0 mb-3 flex max-w-[calc(100vw-1rem)] gap-1 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-1.5 shadow-xl"
        >
          {reactions.map((emoji) => (
            <button
              type="button"
              role="menuitem"
              key={emoji}
              onClick={() => act(() => onReaction(emoji))}
              aria-label={`${tr("React")} ${emoji}`}
              className="w-8 h-8 shrink-0 rounded-full hover:bg-[var(--border-loft)] text-sm transition-transform active:scale-110 motion-reduce:transition-none"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => act(onWave)} aria-label={tr("Wave to the room")} className="w-8 h-8 shrink-0 rounded-full hover:bg-[var(--border-loft)] text-sm">
            <span aria-hidden="true">👋</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={raised} onClick={() => act(onToggleHand)} aria-label={tr(raised ? "Lower hand" : "Raise hand")} className="w-8 h-8 shrink-0 rounded-full hover:bg-[var(--border-loft)] flex items-center justify-center">
            <Hand className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
