"use client";

import { useState } from "react";
import { Star, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  clearPendingFeedback,
  readPendingFeedback,
  type PendingFeedback,
} from "@/lib/callStats";
import { useUIText } from "@/lib/i18n/uiText";
import type { CallFeedbackTag } from "@/types/api";

const TAGS: Array<[CallFeedbackTag, string]> = [
  ["echo", "Echo"],
  ["choppy_audio", "Choppy audio"],
  ["frozen_video", "Frozen video"],
  ["lag", "Lag"],
  ["disconnects", "Disconnected"],
  ["other", "Other"],
];

/** Post-call rating shown once after leaving a call that lasted ≥1 minute. */
export function CallFeedbackPrompt() {
  const tr = useUIText();
  const [pending, setPending] = useState<PendingFeedback | null>(() =>
    typeof window === "undefined" ? null : readPendingFeedback(),
  );
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<CallFeedbackTag[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (!pending) return null;
  const dismiss = () => {
    clearPendingFeedback();
    setPending(null);
  };
  const toggleTag = (tag: CallFeedbackTag) =>
    setTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  const submit = async () => {
    if (!rating || state === "sending") return;
    setState("sending");
    try {
      await api.callFeedback(pending.roomId, pending.credential, {
        ...pending.stats,
        rating,
        tags: rating <= 3 ? tags : [],
      });
      clearPendingFeedback();
      setState("sent");
      setTimeout(() => setPending(null), 1500);
    } catch {
      setState("error");
    }
  };

  return (
    <section
      aria-labelledby="call-feedback-title"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-4 shadow-2xl sm:inset-x-auto sm:right-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id="call-feedback-title" className="text-[13px] font-medium">
          {state === "sent" ? tr("Thanks for the feedback") : tr("How was the call?")}
        </h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label={tr("Close")}
          className="-m-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-loft-muted)] hover:bg-[var(--border-loft-light)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {state !== "sent" && (
        <>
          <div role="radiogroup" aria-label={tr("Rating")} className="mt-3 flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value}/5`}
                onClick={() => setRating(value)}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--border-loft-light)]"
              >
                <Star
                  className={`h-5 w-5 ${value <= rating ? "fill-current text-[var(--text-loft-primary)]" : "text-[var(--text-loft-muted)]"}`}
                />
              </button>
            ))}
          </div>
          {rating > 0 && rating <= 3 && (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label={tr("What went wrong?")}>
              {TAGS.map(([tag, label]) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={tags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-[12px] ${tags.includes(tag) ? "border-transparent bg-[#101113] text-white dark:bg-[#f4f5f7] dark:text-[#101113]" : "border-[var(--border-loft)] text-[var(--text-loft-secondary)]"}`}
                >
                  {tr(label)}
                </button>
              ))}
            </div>
          )}
          {state === "error" && (
            <p role="alert" className="mt-2 text-[12px] text-[var(--text-loft-primary)]">
              {tr("Couldn’t send. Try again.")}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="control-secondary inline-flex h-9 items-center rounded-[10px] px-3 text-[13px] font-medium"
            >
              {tr("Skip")}
            </button>
            <button
              type="button"
              disabled={!rating || state === "sending"}
              onClick={() => void submit()}
              className="control-primary inline-flex h-9 items-center rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
            >
              {tr("Send")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
