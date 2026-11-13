"use client";

import { useCallback } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ModerationReason } from "@/types/api";

export const PAGE_SIZE = 25;

export type AdminT = (vi: string, en: string) => string;

/** Admin copy is written inline in both languages, next to where it is used. */
export function useAdminText() {
  const { locale } = useTranslation();
  const t = useCallback<AdminT>(
    (vi, en) => (locale === "vi" ? vi : en),
    [locale],
  );
  const date = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value)),
    [locale],
  );
  const dateTime = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value)),
    [locale],
  );
  return { t, locale, date, dateTime };
}

export function reasonOptions(t: AdminT): Array<[ModerationReason, string]> {
  return [
    ["illegal", t("Nghi vấn vi phạm pháp luật", "Suspected illegal activity")],
    ["policy", t("Vi phạm điều khoản", "Terms violation")],
    ["safety", t("Đe dọa, quấy rối", "Threats or harassment")],
    ["spam", t("Spam, lừa đảo", "Spam or scams")],
    ["other", t("Lý do khác", "Other")],
  ];
}

export function reasonLabel(t: AdminT, reason?: string) {
  return reasonOptions(t).find(([id]) => id === reason)?.[1] ?? reason ?? "";
}

export function auditActionLabel(t: AdminT, action: string) {
  return (
    (
      {
        "account.suspend": t("Tạm khóa tài khoản", "Suspended account"),
        "account.unsuspend": t("Gỡ tạm khóa", "Lifted suspension"),
        "room.end": t("Kết thúc phòng", "Ended room"),
        "report.actioned": t("Xử lý báo cáo", "Actioned report"),
        "report.dismissed": t("Bỏ qua báo cáo", "Dismissed report"),
      } as Record<string, string>
    )[action] ?? action
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "active" | "danger";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`admin-badge ${tone === "active" ? "admin-badge-active" : tone === "danger" ? "admin-badge-danger" : ""}`}
    >
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
}) {
  return (
    <label className="admin-search">
      <Search size={17} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        value={value}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          <X size={16} />
        </button>
      )}
    </label>
  );
}

export function Pagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useAdminText();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav
      className="admin-pagination"
      aria-label={t("Phân trang", "Pagination")}
    >
      <span className="tabular-nums">
        {total ? page * PAGE_SIZE + 1 : 0}–
        {Math.min((page + 1) * PAGE_SIZE, total)} / {total}
      </span>
      <div>
        <button
          type="button"
          className="admin-button"
          disabled={!page}
          onClick={() => onPage(page - 1)}
        >
          {t("Trước", "Previous")}
        </button>
        <span className="tabular-nums">
          {page + 1} / {pages}
        </span>
        <button
          type="button"
          className="admin-button"
          disabled={page + 1 >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t("Tiếp", "Next")}
        </button>
      </div>
    </nav>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

/** Shared reason + note inputs for every moderation decision. */
export function DecisionFields({
  reason,
  note,
  onReason,
  onNote,
  disabled,
  noteRequired = true,
  hideReason = false,
  idPrefix,
}: {
  reason?: string;
  note: string;
  onReason?: (reason: string) => void;
  onNote: (note: string) => void;
  disabled?: boolean;
  noteRequired?: boolean;
  hideReason?: boolean;
  idPrefix: string;
}) {
  const { t } = useAdminText();
  return (
    <>
      {!hideReason && onReason && (
        <label className="admin-field">
          {t("Lý do xử lý", "Moderation reason")}
          <select
            className="admin-select"
            value={reason}
            disabled={disabled}
            onChange={(e) => onReason(e.target.value)}
          >
            <option value="">{t("Chọn lý do", "Select reason")}</option>
            {reasonOptions(t).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="admin-field">
        {noteRequired
          ? t("Ghi chú xử lý", "Moderation note")
          : t("Ghi chú (không bắt buộc)", "Note (optional)")}
        <textarea
          className="admin-textarea"
          value={note}
          disabled={disabled}
          minLength={noteRequired ? 10 : 0}
          maxLength={1000}
          rows={3}
          aria-describedby={`${idPrefix}-note-help`}
          onChange={(e) => onNote(e.target.value)}
        />
        <span id={`${idPrefix}-note-help`} className="admin-help">
          {noteRequired
            ? t(
                `${note.trim().length}/1000 · tối thiểu 10 ký tự. Ghi hành vi và căn cứ; không nhập mật khẩu hay dữ liệu nhạy cảm.`,
                `${note.trim().length}/1000 · at least 10 characters. Describe the conduct and basis; omit passwords and sensitive data.`,
              )
            : `${note.trim().length}/1000`}
        </span>
      </label>
    </>
  );
}

export const noteValid = (note: string) =>
  note.trim().length >= 10 && note.trim().length <= 1000;
