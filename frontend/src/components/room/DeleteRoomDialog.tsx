"use client";

import { useUIText } from "@/lib/i18n/uiText";
import type { Locale } from "@/lib/i18n/types";
import type { ApiRoom } from "@/types/api";

export function DeleteRoomDialog({ room, locale, pending, error, onCancel, onConfirm }: {
  room: ApiRoom | null;
  locale: Locale;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tr = useUIText();
  if (!room) return null;
  return (
    <div className="fixed inset-0 bg-[#101113]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-room-title" aria-describedby="delete-room-description" className="w-full max-w-md rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 text-[var(--text-loft-primary)] shadow-2xl motion-reduce:transform-none sm:[transform:perspective(1200px)_rotateX(1deg)]">
        <h2 id="delete-room-title" className="text-[11px] font-medium">{locale === "vi" ? "Xóa phòng vĩnh viễn?" : "Delete room permanently?"}</h2>
        <p id="delete-room-description" className="mt-3 text-[11px] text-[var(--text-loft-secondary)]">
          {locale === "vi" ? `Phòng “${room.name}”, tin nhắn và link mời sẽ bị xóa vĩnh viễn. Không thể hoàn tác.` : `“${room.name}”, its messages, and invite link will be permanently deleted. This cannot be undone.`}
        </p>
        {error && <p role="alert" className="mt-3 text-[11px] text-[var(--text-loft-primary)]">{tr(error)}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={pending} onClick={onCancel} className="btn-press rounded-[6px] border border-[var(--border-loft)] px-4 py-2 text-[11px] hover-invert disabled:opacity-50">{locale === "vi" ? "Hủy" : "Cancel"}</button>
          <button type="button" disabled={pending} onClick={onConfirm} className="btn-press rounded-[6px] bg-[#101113] px-4 py-2 text-[11px] font-medium text-white disabled:opacity-50">{pending ? (locale === "vi" ? "Đang xóa…" : "Deleting…") : (locale === "vi" ? "Xóa phòng" : "Delete room")}</button>
        </div>
      </div>
    </div>
  );
}
