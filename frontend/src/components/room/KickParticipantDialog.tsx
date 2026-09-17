"use client";

import { useEffect, useRef } from "react";
import { useUIText } from "@/lib/i18n/uiText";

export function KickParticipantDialog({
  name,
  onCancel,
  onConfirm,
  action = "kick",
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  action?: "kick" | "ban";
}) {
  const tr = useUIText();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#101113]/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-participant-title"
        aria-describedby="kick-participant-description"
        className="w-full max-w-md rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 text-[var(--text-loft-primary)] shadow-2xl motion-reduce:transform-none sm:[transform:perspective(1200px)_rotateX(1deg)]"
      >
        <h2 id="kick-participant-title" className="text-[11px] font-medium">
          {tr(action === "ban" ? "Temporarily ban participant" : "Remove participant")}
        </h2>
        <p id="kick-participant-description" className="mt-3 text-[11px] text-[var(--text-loft-secondary)]">
          {tr(action === "ban" ? "Temporary ban confirmation" : "Remove participant confirmation").replace("{name}", name)}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="btn-press rounded-[6px] border border-[var(--border-loft)] px-4 py-2 text-[11px] hover-invert"
          >
            {tr("Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-press rounded-[6px] bg-[#101113] px-4 py-2 text-[11px] font-medium text-white"
          >
            {tr(action === "ban" ? "Ban for 1 hour" : "Remove participant")}
          </button>
        </div>
      </div>
    </div>
  );
}
