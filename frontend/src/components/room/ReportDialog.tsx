"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useUIText } from "@/lib/i18n/uiText";
import type {
  ModerationReason,
  ReportTargetType,
  RoomCredential,
} from "@/types/api";

export interface ReportTarget {
  type: ReportTargetType;
  /** Identity id for people; ignored for the room, which the server fills in. */
  id: string;
  name: string;
}

const REASONS: Array<[ModerationReason, string]> = [
  ["safety", "Threats or harassment"],
  ["spam", "Spam or scams"],
  ["illegal", "Suspected illegal activity"],
  ["policy", "Terms violation"],
  ["other", "Other"],
];

/**
 * Sends a report to Mingly's admins. Nobody in the room is told, including
 * the person reported.
 */
export function ReportDialog({
  roomId,
  credential,
  target,
  onClose,
}: {
  roomId: string;
  credential: RoomCredential;
  target: ReportTarget;
  onClose: () => void;
}) {
  const tr = useUIText();
  const [reason, setReason] = useState<ModerationReason | "">("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"editing" | "sending" | "sent">("editing");
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  useEffect(() => {
    if (state === "sent") doneRef.current?.focus();
  }, [state]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason || state === "sending") return;
    setState("sending");
    setError("");
    try {
      await api.report(roomId, credential, {
        target_type: target.type,
        target_id: target.type === "room" ? "" : target.id,
        target_name: target.name,
        reason,
        details: details.trim(),
      });
      setState("sent");
    } catch (cause) {
      setState("editing");
      if (cause instanceof ApiError && cause.code === "REPORT_ALREADY_OPEN") {
        setState("sent");
        return;
      }
      setError(
        cause instanceof ApiError && cause.code === "RATE_LIMITED"
          ? tr("Too many reports. Try again later.")
          : tr("Could not send the report. Try again."),
      );
    }
  };

  const title =
    target.type === "room"
      ? tr("Report this room")
      : tr("Report {name}").replace("{name}", target.name);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#101113]/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && state !== "sending")
          onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="w-full max-w-md rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 text-[var(--text-loft-primary)] shadow-2xl"
      >
        <h2
          id="report-title"
          className="text-[15px] font-medium [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        {state === "sent" ? (
          <>
            <p
              role="status"
              className="mt-3 text-[13px] leading-relaxed text-[var(--text-loft-secondary)]"
            >
              {tr(
                "Report sent. Mingly's admins will review it. Nobody in the room is told who reported.",
              )}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                ref={doneRef}
                type="button"
                onClick={onClose}
                className="btn-press min-h-11 rounded-[10px] bg-[#101113] px-4 text-[13px] font-medium text-white dark:bg-[#f4f5f7] dark:text-[#101113]"
              >
                {tr("Done")}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-loft-secondary)]">
              {tr(
                "Only Mingly's admins see reports. Nobody in the room is told.",
              )}
            </p>
            <fieldset className="mt-5">
              <legend className="mb-2 text-[13px] font-medium">
                {tr("What's happening?")}
              </legend>
              <div className="grid gap-1">
                {REASONS.map(([value, label], index) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-[13px] hover:bg-[var(--bg-loft-surface)] has-[:checked]:bg-[var(--bg-loft-surface)]"
                  >
                    <input
                      ref={index === 0 ? firstRef : undefined}
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={reason === value}
                      onChange={() => setReason(value)}
                      className="h-4 w-4 accent-[var(--text-loft-primary)]"
                    />
                    {tr(label)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-4 block text-[13px] font-medium">
              {tr("Details (optional)")}
              <textarea
                value={details}
                maxLength={1000}
                rows={3}
                onChange={(event) => setDetails(event.target.value)}
                aria-describedby="report-details-help"
                className="mt-2 block w-full rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[13px] font-normal"
              />
            </label>
            <p
              id="report-details-help"
              className="mt-1 text-[12px] text-[var(--text-loft-muted)]"
            >
              {tr("What happened and when. Don't include passwords.")}{" "}
              {details.length}/1000
            </p>
            {error && (
              <p
                role="alert"
                className="mt-3 text-[13px] text-[#b42318] dark:text-[#ff9b91]"
              >
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={state === "sending"}
                className="btn-press min-h-11 rounded-[10px] border border-[var(--border-loft)] px-4 text-[13px] hover-invert"
              >
                {tr("Cancel")}
              </button>
              <button
                type="submit"
                disabled={!reason || state === "sending"}
                className="btn-press min-h-11 rounded-[10px] bg-[#101113] px-4 text-[13px] font-medium text-white disabled:opacity-50 dark:bg-[#f4f5f7] dark:text-[#101113]"
              >
                {state === "sending" ? tr("Sending…") : tr("Send report")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
