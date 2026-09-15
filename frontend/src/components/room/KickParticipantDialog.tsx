"use client";

import { useEffect, useRef } from "react";
import { useUIText } from "@/lib/i18n/uiText";

export function KickParticipantDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
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
        className="w-full max-w-md rounded-2xl border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 text-[var(--text-loft-primary)] shadow-2xl"
      >
        <h2 id="kick-participant-title" className="text-lg font-semibold">
          {tr("Remove participant")}
        </h2>
        <p id="kick-participant-description" className="mt-3 text-sm text-[var(--text-loft-secondary)]">
          {tr("Remove participant confirmation").replace("{name}", name)}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[var(--border-loft)] px-4 py-2 text-sm hover:bg-[var(--border-loft-light)]"
          >
            {tr("Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-[#FF3B30] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e6352b]"
          >
            {tr("Remove participant")}
          </button>
        </div>
      </div>
    </div>
  );
}
