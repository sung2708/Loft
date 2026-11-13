"use client";

import { useState } from "react";
import { ArrowUpRight, Check, X } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { AdminReport, ReportStatus } from "@/types/api";
import {
  Badge,
  DecisionFields,
  EmptyRow,
  PAGE_SIZE,
  Pagination,
  noteValid,
  reasonLabel,
  useAdminText,
  type AdminT,
} from "./shared";
import { useAdminData, useAdminSession } from "./useAdminData";
import { Placeholder } from "./OverviewSection";
import { parsePage, type AdminParams, type SetParams } from "./params";

const STATUSES: ReportStatus[] = ["open", "actioned", "dismissed"];

export function targetTypeLabel(t: AdminT, type: AdminReport["target_type"]) {
  return type === "room"
    ? t("Phòng", "Room")
    : type === "guest"
      ? t("Khách", "Guest")
      : t("Thành viên", "Member");
}

export function ReportsSection({
  params,
  setParams,
  onInspectUser,
  onInspectRoom,
}: {
  params: AdminParams;
  setParams: SetParams;
  onInspectUser: (id: string, name: string) => void;
  onInspectRoom: (id: string) => void;
}) {
  const { t, locale } = useAdminText();
  const page = parsePage(params.page);
  const status = (
    STATUSES.includes(params.status as ReportStatus) ? params.status : "open"
  ) as ReportStatus;
  const { data, loading, failed } = useAdminData(
    (token) => api.adminReports(token, status, PAGE_SIZE, page * PAGE_SIZE),
    [status, page],
  );
  const labels: Record<ReportStatus, string> = {
    open: t("Chờ xử lý", "Open"),
    actioned: t("Đã xử lý", "Actioned"),
    dismissed: t("Đã bỏ qua", "Dismissed"),
  };
  return (
    <section className="admin-panel">
      <div className="admin-toolbar">
        <div
          className="admin-segmented"
          role="group"
          aria-label={t("Lọc báo cáo", "Filter reports")}
        >
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setParams({ status: value })}
            >
              {labels[value]}
            </button>
          ))}
        </div>
        <span className="admin-result-count" aria-live="polite">
          {(data?.total ?? 0).toLocaleString(locale)}{" "}
          {t("báo cáo", data?.total === 1 ? "report" : "reports")}
          {status === "open" && data?.total
            ? ` · ${t("cũ nhất trước", "oldest first")}`
            : ""}
        </span>
      </div>
      {data ? (
        <ol className="admin-reports">
          {data.items.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onInspectUser={onInspectUser}
              onInspectRoom={onInspectRoom}
            />
          ))}
          {!data.items.length && (
            <EmptyRow>
              {status === "open"
                ? t("Không còn báo cáo nào chờ xử lý.", "No open reports.")
                : t("Chưa có báo cáo.", "No reports yet.")}
            </EmptyRow>
          )}
        </ol>
      ) : (
        <Placeholder loading={loading} failed={failed} />
      )}
      <Pagination
        page={page}
        total={data?.total ?? 0}
        onPage={(next) => setParams({ page: String(next) }, { keepPage: true })}
      />
    </section>
  );
}

function ReportCard({
  report,
  onInspectUser,
  onInspectRoom,
}: {
  report: AdminReport;
  onInspectUser: (id: string, name: string) => void;
  onInspectRoom: (id: string) => void;
}) {
  const { t, dateTime } = useAdminText();
  const { token, refresh, notify } = useAdminSession();
  const [deciding, setDeciding] = useState<"actioned" | "dismissed" | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const headingId = `report-${report.id}`;
  const resolve = async () => {
    if (!deciding || pending) return;
    setPending(true);
    setError("");
    try {
      await api.adminResolveReport(token, report.id, deciding, note.trim());
      notify(
        deciding === "actioned"
          ? t("Đã đánh dấu đã xử lý", "Marked as actioned")
          : t("Đã bỏ qua báo cáo", "Report dismissed"),
      );
      refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "REPORT_ALREADY_RESOLVED"
          ? t(
              "Quản trị viên khác đã xử lý báo cáo này.",
              "Another admin already closed this report.",
            )
          : t("Không lưu được. Hãy thử lại.", "Could not save. Try again."),
      );
      if (cause instanceof ApiError && cause.code === "REPORT_ALREADY_RESOLVED")
        refresh();
    } finally {
      setPending(false);
    }
  };
  const canSave =
    deciding === "dismissed" ? note.trim().length <= 1000 : noteValid(note);
  return (
    <li className="admin-report" aria-labelledby={headingId}>
      <div className="admin-report-head">
        <div>
          <h3 id={headingId}>
            {report.target_type === "room" ? (
              <button
                type="button"
                className="admin-link"
                onClick={() => onInspectRoom(report.target_id)}
              >
                {report.target_name}
              </button>
            ) : report.target_type === "user" ? (
              <button
                type="button"
                className="admin-link"
                onClick={() =>
                  onInspectUser(report.target_id, report.target_name)
                }
              >
                {report.target_name}
              </button>
            ) : (
              report.target_name
            )}
          </h3>
          <p className="admin-sub">
            {targetTypeLabel(t, report.target_type)} · {t("trong", "in")}{" "}
            {report.room_name || report.room_id} · {dateTime(report.created_at)}
          </p>
        </div>
        <div className="admin-badges">
          <Badge tone="danger">{reasonLabel(t, report.reason)}</Badge>
          {report.target_reports > 1 && (
            <Badge>
              {report.target_reports}{" "}
              {t("báo cáo về đối tượng này", "reports on this target")}
            </Badge>
          )}
        </div>
      </div>
      {report.details && (
        <blockquote className="admin-quote">{report.details}</blockquote>
      )}
      <p className="admin-sub">
        {t("Người báo cáo", "Reported by")}: {report.reporter_name} (
        {report.reporter_type === "guest"
          ? t("khách", "guest")
          : t("thành viên", "member")}
        )
      </p>
      {report.status !== "open" ? (
        <p className="admin-sub">
          {report.status === "actioned"
            ? t("Đã xử lý", "Actioned")
            : t("Đã bỏ qua", "Dismissed")}
          {report.resolved_at ? ` · ${dateTime(report.resolved_at)}` : ""}
          {report.resolution_note ? ` · ${report.resolution_note}` : ""}
        </p>
      ) : deciding ? (
        <div className="admin-report-decision">
          <DecisionFields
            note={note}
            onNote={setNote}
            disabled={pending}
            noteRequired={deciding === "actioned"}
            hideReason
            idPrefix={headingId}
          />
          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}
          <div className="admin-actions">
            <button
              type="button"
              className="admin-button"
              disabled={pending}
              onClick={() => setDeciding(null)}
            >
              {t("Hủy", "Cancel")}
            </button>
            <button
              type="button"
              className="admin-button admin-primary"
              disabled={pending || !canSave}
              onClick={() => void resolve()}
            >
              {pending
                ? t("Đang lưu…", "Saving…")
                : deciding === "actioned"
                  ? t("Lưu đã xử lý", "Save as actioned")
                  : t("Bỏ qua", "Dismiss")}
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-actions">
          {report.target_type === "user" && (
            <button
              type="button"
              className="admin-button"
              onClick={() =>
                onInspectUser(report.target_id, report.target_name)
              }
            >
              {t("Mở tài khoản", "Open account")}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="admin-button"
            onClick={() => onInspectRoom(report.room_id)}
          >
            {t("Mở phòng", "Open room")}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
          <span className="admin-actions-spacer" />
          <button
            type="button"
            className="admin-button"
            onClick={() => setDeciding("dismissed")}
          >
            <X size={14} aria-hidden="true" />
            {t("Bỏ qua", "Dismiss")}
          </button>
          <button
            type="button"
            className="admin-button admin-primary"
            onClick={() => setDeciding("actioned")}
          >
            <Check size={14} aria-hidden="true" />
            {t("Đánh dấu đã xử lý", "Mark actioned")}
          </button>
        </div>
      )}
    </li>
  );
}
