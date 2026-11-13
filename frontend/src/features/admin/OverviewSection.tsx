"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  DoorOpen,
  Flag,
  LayoutDashboard,
  Trash2,
  UserX,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AdminDailyCount, AdminRoom } from "@/types/api";
import { useAdminText } from "./shared";
import { useAdminData, useAdminSession } from "./useAdminData";
import { RoomTable } from "./RoomsSection";
import type { Navigate } from "./params";

export function OverviewSection({
  navigate,
  onInspectRoom,
}: {
  navigate: Navigate;
  onInspectRoom: (room: AdminRoom) => void;
}) {
  const { t, locale } = useAdminText();
  const { data, loading, failed } = useAdminData(
    (token) =>
      Promise.all([
        api.adminOverview(token),
        api.adminRooms(token, "", 6),
        // Optional: the dashboard still loads if feedback is unavailable.
        api.adminCallQuality(token).catch(() => null),
      ]),
    [],
  );
  if (!data) return <Placeholder loading={loading} failed={failed} />;
  const [loaded, recent, quality] = data;
  // Fields added with reports and deletions may be missing from an older API.
  const overview = {
    ...loaded,
    open_reports: loaded.open_reports ?? 0,
    suspended_users: loaded.suspended_users ?? 0,
    pending_deletions: loaded.pending_deletions ?? 0,
    daily: loaded.daily ?? [],
  };
  const number = (value: number) => value.toLocaleString(locale);
  const attention = [
    {
      count: overview.open_reports,
      label: t("báo cáo chờ xử lý", "open reports"),
      icon: Flag,
      go: () => navigate("reports"),
    },
    {
      count: overview.suspended_users,
      label: t("tài khoản đang bị khóa", "suspended accounts"),
      icon: UserX,
      go: () => navigate("users", { status: "suspended" }),
    },
    {
      count: overview.pending_deletions,
      label: t("tài khoản chờ xóa", "accounts pending deletion"),
      icon: Trash2,
      go: () => navigate("users", { status: "deleting" }),
    },
  ];
  const stats = [
    {
      label: t("Người dùng", "Users"),
      value: overview.users,
      detail: `+${number(overview.new_users)} ${t("trong 7 ngày", "in 7 days")}`,
      icon: Users,
      go: () => navigate("users"),
    },
    {
      label: t("Tổng số phòng", "Total rooms"),
      value: overview.rooms,
      detail: `+${number(overview.new_rooms)} ${t("trong 7 ngày", "in 7 days")}`,
      icon: DoorOpen,
      go: () => navigate("rooms"),
    },
    {
      label: t("Chưa kết thúc", "Not ended"),
      value: overview.open_rooms,
      detail: t("Xem danh sách phòng", "View room list"),
      icon: LayoutDashboard,
      go: () => navigate("rooms", { status: "open" }),
    },
    {
      label: t("Đã kết thúc", "Ended"),
      value: overview.ended_rooms,
      detail: t("Xem lịch sử phòng", "View room history"),
      icon: Check,
      go: () => navigate("rooms", { status: "ended" }),
    },
  ];
  return (
    <>
      <section
        className="admin-attention"
        aria-label={t("Cần xử lý", "Needs attention")}
      >
        {attention.map(({ count, label, icon: Icon, go }) => (
          <button
            key={label}
            type="button"
            className={`admin-attention-item ${count ? "is-due" : ""}`}
            onClick={go}
          >
            <Icon size={16} aria-hidden="true" />
            <strong className="tabular-nums">{number(count)}</strong>
            <span>{label}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ))}
      </section>
      <section className="admin-stats" aria-label={t("Thống kê", "Statistics")}>
        {stats.map(({ label, value, detail, icon: Icon, go }) => (
          <button key={label} type="button" className="admin-stat" onClick={go}>
            <span className="admin-stat-top">
              {label}
              <Icon size={17} aria-hidden="true" />
            </span>
            <strong>{number(value)}</strong>
            <span className="admin-stat-bottom">
              {detail}
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </button>
        ))}
      </section>
      {overview.daily.length > 0 && (
        <section
          className="admin-panel admin-trends"
          aria-labelledby="admin-trends-title"
        >
          <div className="admin-panel-heading">
            <div>
              <h2 id="admin-trends-title">
                {t("Xu hướng 14 ngày", "Last 14 days")}
              </h2>
              <p>
                {t(
                  "Theo ngày (UTC). Hôm nay tính đến hiện tại.",
                  "Per UTC day. Today is so far.",
                )}
              </p>
            </div>
          </div>
          <div className="admin-trend-grid">
            <TrendBars
              title={t("Người dùng mới", "New users")}
              days={overview.daily}
              pick={(d) => d.users}
            />
            <TrendBars
              title={t("Phòng mới", "New rooms")}
              days={overview.daily}
              pick={(d) => d.rooms}
            />
          </div>
        </section>
      )}
      {quality && (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>{t("Chất lượng cuộc gọi", "Call quality")}</h2>
              <p>{t("7 ngày gần nhất", "Last 7 days")}</p>
            </div>
            {quality.responses > 0 &&
              quality.low_ratings / quality.responses > 0.2 && (
                <span className="admin-badge admin-badge-danger">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {t("Nhiều đánh giá thấp", "Many low ratings")}
                </span>
              )}
          </div>
          <dl className="admin-metrics">
            <div>
              <dt>{t("Lượt đánh giá", "Ratings")}</dt>
              <dd className="tabular-nums">{number(quality.responses)}</dd>
            </div>
            <div>
              <dt>{t("Điểm trung bình", "Average rating")}</dt>
              <dd className="tabular-nums">
                {quality.responses
                  ? `${quality.average_rating.toFixed(2)} / 5`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Đánh giá thấp (≤2)", "Low ratings (≤2)")}</dt>
              <dd className="tabular-nums">{number(quality.low_ratings)}</dd>
            </div>
            <div>
              <dt>{t("Thời gian mạng kém", "Time on poor network")}</dt>
              <dd className="tabular-nums">
                {(quality.poor_share * 100).toFixed(1)}%
              </dd>
            </div>
          </dl>
          {Object.keys(quality.tags).length > 0 && (
            <p className="admin-panel-foot">
              {t("Vấn đề hay gặp", "Reported issues")}:{" "}
              {Object.entries(quality.tags)
                .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                .map(([tag, count]) => `${tag} (${count})`)
                .join(" · ")}
            </p>
          )}
        </section>
      )}
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>{t("Phòng mới tạo", "Recently created rooms")}</h2>
            <p>{t("6 phòng gần nhất", "6 most recent rooms")}</p>
          </div>
          <button
            type="button"
            className="admin-button"
            onClick={() => navigate("rooms")}
          >
            {t("Xem tất cả", "View all")}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>
        <RoomTable rooms={recent.items} onInspect={onInspectRoom} />
      </section>
    </>
  );
}

/**
 * One series per chart: bars in the primary ink, rounded at the data end,
 * 2px gaps, a hover/focus readout and a screen-reader table.
 */
function TrendBars({
  title,
  days,
  pick,
}: {
  title: string;
  days: AdminDailyCount[];
  pick: (day: AdminDailyCount) => number;
}) {
  const { locale } = useAdminText();
  const [active, setActive] = useState<number | null>(null);
  const values = days.map(pick);
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const label = (day: AdminDailyCount) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${day.date}T00:00:00Z`));
  const shown = active ?? days.length - 1;
  return (
    <figure className="admin-trend">
      <figcaption>
        <span>{title}</span>
        <strong className="tabular-nums">{total.toLocaleString(locale)}</strong>
      </figcaption>
      <p className="admin-trend-readout" aria-hidden="true">
        {days[shown]
          ? `${label(days[shown])}: ${values[shown].toLocaleString(locale)}`
          : ""}
      </p>
      <div
        className="admin-trend-bars"
        aria-hidden="true"
        onMouseLeave={() => setActive(null)}
      >
        {days.map((day, index) => (
          <span
            key={day.date}
            className={`admin-trend-bar ${index === shown ? "is-active" : ""}`}
            onMouseEnter={() => setActive(index)}
          >
            <span
              style={{
                height: `${Math.max(values[index] ? 4 : 0, (values[index] / max) * 100)}%`,
              }}
            />
          </span>
        ))}
      </div>
      <div className="admin-trend-axis" aria-hidden="true">
        <span>{days[0] ? label(days[0]) : ""}</span>
        <span>{days.length ? label(days[days.length - 1]) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {days.map((day, index) => (
            <tr key={day.date}>
              <th scope="row">{label(day)}</th>
              <td>{values[index]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Placeholder({
  loading,
  failed,
}: {
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useAdminText();
  const { refresh } = useAdminSession();
  if (failed && !loading) {
    return (
      <div role="alert" className="admin-panel admin-empty">
        <p>{t("Không tải được dữ liệu.", "Could not load data.")}</p>
        <button type="button" className="admin-button mt-4" onClick={refresh}>
          {t("Thử lại", "Retry")}
        </button>
      </div>
    );
  }
  return (
    <div role="status" className="admin-panel admin-empty">
      {t("Đang tải…", "Loading…")}
    </div>
  );
}
