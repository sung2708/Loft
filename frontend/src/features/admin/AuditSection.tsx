"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminAuditFilter } from "@/types/api";
import {
  EmptyRow,
  PAGE_SIZE,
  Pagination,
  SearchBox,
  auditActionLabel,
  reasonLabel,
  useAdminText,
} from "./shared";
import { useAdminData, useAdminSession, useDebounced } from "./useAdminData";
import { Placeholder } from "./OverviewSection";
import { parsePage, type AdminParams, type SetParams } from "./params";

const ACTIONS = [
  "account.suspend",
  "account.unsuspend",
  "room.end",
  "report.actioned",
  "report.dismissed",
];

export function AuditSection({
  params,
  setParams,
  onInspectTarget,
}: {
  params: AdminParams;
  setParams: SetParams;
  onInspectTarget: (type: string, id: string) => void;
}) {
  const { t, dateTime } = useAdminText();
  const { token, notify } = useAdminSession();
  const [target, setTarget] = useState(params.target ?? "");
  const settledTarget = useDebounced(target);
  const [exporting, setExporting] = useState(false);
  const page = parsePage(params.page);
  const filter: AdminAuditFilter = {
    action: params.action,
    actor: params.actor,
    target: params.target,
    from: params.from,
    to: params.to,
  };
  useEffect(() => {
    if (settledTarget !== (params.target ?? ""))
      setParams({ target: settledTarget });
    // Only a settled search text writes to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledTarget]);
  const { data, loading, failed } = useAdminData(
    (token) => api.adminAudit(token, filter, PAGE_SIZE, page * PAGE_SIZE),
    [params.action, params.actor, params.target, params.from, params.to, page],
  );
  const filtered = Boolean(
    params.action || params.actor || params.target || params.from || params.to,
  );
  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.adminAuditExport(token, filter);
    } catch {
      notify(
        t("Không xuất được tệp. Hãy thử lại.", "Could not export. Try again."),
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="admin-panel">
      <div className="admin-toolbar">
        <SearchBox
          value={target}
          onChange={setTarget}
          label={t("ID đối tượng", "Target ID")}
          clearLabel={t("Xóa", "Clear")}
          placeholder={t("ID tài khoản hoặc phòng…", "Account or room ID…")}
        />
        <select
          className="admin-select"
          aria-label={t("Thao tác", "Action")}
          value={params.action ?? ""}
          onChange={(e) => setParams({ action: e.target.value })}
        >
          <option value="">{t("Mọi thao tác", "All actions")}</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {auditActionLabel(t, action)}
            </option>
          ))}
        </select>
        <label className="admin-date">
          <span>{t("Từ", "From")}</span>
          <input
            type="date"
            className="admin-input"
            value={params.from ?? ""}
            max={params.to || undefined}
            onChange={(e) => setParams({ from: e.target.value })}
          />
        </label>
        <label className="admin-date">
          <span>{t("Đến", "To")}</span>
          <input
            type="date"
            className="admin-input"
            value={params.to ?? ""}
            min={params.from || undefined}
            onChange={(e) => setParams({ to: e.target.value })}
          />
        </label>
        {filtered && (
          <button
            type="button"
            className="admin-button"
            onClick={() => {
              setTarget("");
              setParams({
                action: "",
                actor: "",
                target: "",
                from: "",
                to: "",
              });
            }}
          >
            {t("Bỏ lọc", "Clear filters")}
          </button>
        )}
        <button
          type="button"
          className="admin-button admin-push"
          disabled={exporting || !data?.total}
          onClick={() => void exportCsv()}
        >
          <Download size={14} aria-hidden="true" />
          {exporting
            ? t("Đang xuất…", "Exporting…")
            : t("Xuất CSV", "Export CSV")}
        </button>
      </div>
      {params.actor && (
        <div className="admin-owner-filter">
          <span className="mono">
            {t("Người xử lý", "Administrator")}: {params.actor}
          </span>
          <button
            type="button"
            className="admin-button"
            onClick={() => setParams({ actor: "" })}
          >
            {t("Bỏ", "Clear")}
          </button>
        </div>
      )}
      {data ? (
        <div className="admin-table-wrap">
          <table className="admin-table admin-audit">
            <caption className="sr-only">
              {t("Nhật ký quản trị", "Admin audit log")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("Thao tác", "Action")}</th>
                <th scope="col">{t("Đối tượng", "Target")}</th>
                <th scope="col">{t("Người xử lý", "Administrator")}</th>
                <th scope="col">{t("Thời điểm", "When")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="admin-wrap">
                    <strong className="admin-truncate">
                      {auditActionLabel(t, entry.action)}
                    </strong>
                    {entry.reason && (
                      <span className="admin-sub">
                        {reasonLabel(t, entry.reason)}
                      </span>
                    )}
                    {entry.note && (
                      <span className="admin-note">{entry.note}</span>
                    )}
                    {entry.expires_at && (
                      <span className="admin-sub">
                        {t("Đến", "Until")} {dateTime(entry.expires_at)}
                      </span>
                    )}
                  </td>
                  <td>
                    {entry.target_type === "user" ||
                    entry.target_type === "room" ? (
                      <button
                        type="button"
                        className="admin-link mono"
                        onClick={() =>
                          onInspectTarget(entry.target_type, entry.target_id)
                        }
                      >
                        {entry.target_id}
                      </button>
                    ) : (
                      <span className="admin-sub mono">{entry.target_id}</span>
                    )}
                    <span className="admin-sub">{entry.target_type}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-link"
                      onClick={() => setParams({ actor: entry.actor_id })}
                      title={t(
                        "Lọc theo người này",
                        "Filter by this administrator",
                      )}
                    >
                      {entry.actor_name || entry.actor_id.slice(0, 8)}
                    </button>
                  </td>
                  <td>
                    <time dateTime={entry.created_at}>
                      {dateTime(entry.created_at)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && (
            <EmptyRow>
              {filtered
                ? t(
                    "Không có thao tác nào khớp bộ lọc.",
                    "No actions match these filters.",
                  )
                : t("Chưa có thao tác nào.", "No actions yet.")}
            </EmptyRow>
          )}
        </div>
      ) : (
        <Placeholder loading={loading} failed={failed} />
      )}
      <Pagination
        page={page}
        total={data?.total ?? 0}
        onPage={(next) => setParams({ page: String(next) }, { keepPage: true })}
      />
      {data && data.total > 5000 && (
        <p className="admin-panel-foot">
          {t(
            "Tệp CSV chứa tối đa 5.000 dòng mới nhất. Thu hẹp khoảng ngày để xuất phần còn lại.",
            "CSV exports hold the newest 5,000 rows. Narrow the dates to export the rest.",
          )}
        </p>
      )}
    </section>
  );
}
