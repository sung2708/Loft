"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { api } from "@/lib/api";

/** Shown on every signed-in page while an account deletion is pending. */
export function DeletionBanner({
  token,
  scheduledFor,
  vi,
  onCancelled,
}: {
  token: string;
  scheduledFor: string;
  vi: boolean;
  onCancelled: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const when = new Intl.DateTimeFormat(vi ? "vi" : "en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(scheduledFor));
  const cancel = async () => {
    setPending(true);
    setFailed(false);
    try {
      await api.cancelAccountDeletion(token);
      onCancelled();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-[10px] border border-[#b42318]/40 bg-[#b42318]/[0.06] px-4 py-3 text-[13px] sm:flex-row sm:items-center dark:border-[#ff9b91]/40 dark:bg-[#ff9b91]/[0.08]"
    >
      <CircleAlert
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-[#b42318] dark:text-[#ff9b91]"
      />
      <p className="flex-1">
        {vi
          ? `Tài khoản của bạn sẽ bị xóa vĩnh viễn vào ${when}. Các phòng bạn làm chủ sẽ bị xóa cùng lúc.`
          : `Your account will be permanently deleted on ${when}. Rooms you host are deleted with it.`}
        {failed && (
          <span className="mt-1 block text-[#b42318] dark:text-[#ff9b91]">
            {vi
              ? "Không hủy được. Hãy thử lại."
              : "Could not cancel. Try again."}
          </span>
        )}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => void cancel()}
        className="btn-press inline-flex min-h-10 shrink-0 items-center justify-center rounded-[10px] bg-[#101113] px-4 font-medium text-white disabled:opacity-50 dark:bg-[#f4f5f7] dark:text-[#101113]"
      >
        {pending
          ? vi
            ? "Đang hủy…"
            : "Cancelling…"
          : vi
            ? "Giữ tài khoản"
            : "Keep account"}
      </button>
    </div>
  );
}
