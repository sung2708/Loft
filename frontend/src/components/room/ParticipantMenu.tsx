"use client";

import { MoreHorizontal, Shield, UserRoundCheck, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApiParticipant } from "@/types/api";
import { useUIText } from "@/lib/i18n/uiText";

export type ParticipantAction = "transfer" | "kick" | "ban";

export function ParticipantMenu({
  participant,
  canTransfer,
  disabled,
  onAction,
}: {
  participant: ApiParticipant;
  canTransfer: boolean;
  disabled?: boolean;
  onAction: (action: ParticipantAction) => void;
}) {
  const tr = useUIText();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (action: ParticipantAction) => {
    setOpen(false);
    onAction(action);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-label={`${tr("Participant actions")}: ${participant.display_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={tr("Participant actions")}
        onClick={() => setOpen((value) => !value)}
        className="rounded-[6px] p-2 text-[var(--text-loft-secondary)] hover-invert disabled:opacity-50"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`${tr("Participant actions")}: ${participant.display_name}`}
          className="absolute bottom-full right-0 z-50 mb-2 min-w-44 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-1 shadow-xl motion-reduce:transform-none sm:[transform:perspective(900px)_rotateX(2deg)]"
        >
          {canTransfer && participant.identity_type === "user" && (
            <button type="button" role="menuitem" onClick={() => choose("transfer")} className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[11px] hover-invert">
              <UserRoundCheck className="w-4 h-4" /> {tr("Make host")}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => choose("kick")} className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[11px] text-[var(--text-loft-primary)] hover-invert">
            <UserX className="w-4 h-4" /> {tr("Remove participant")}
          </button>
          <button type="button" role="menuitem" onClick={() => choose("ban")} className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[11px] text-[var(--text-loft-primary)] hover-invert">
            <Shield className="w-4 h-4" /> {tr("Ban for 1 hour")}
          </button>
        </div>
      )}
    </div>
  );
}
