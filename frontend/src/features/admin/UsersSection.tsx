"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminUser, AdminUserStatus } from "@/types/api";
import {
  Badge,
  EmptyRow,
  PAGE_SIZE,
  Pagination,
  SearchBox,
  useAdminText,
} from "./shared";
import { useAdminData, useDebounced } from "./useAdminData";
import { Placeholder } from "./OverviewSection";
import { parsePage, type AdminParams, type SetParams } from "./params";

const STATUSES: AdminUserStatus[] = ["", "reported", "suspended", "deleting"];

export function UserBadges({ user }: { user: AdminUser }) {
  const { t, date } = useAdminText();
  return (
    <>
      {user.suspension && (
        <Badge tone="danger">{t("Tạm khóa", "Suspended")}</Badge>
      )}
      {user.deletion_scheduled_for && (
        <Badge>
          {t("Xóa vào", "Deletes")} {date(user.deletion_scheduled_for)}
        </Badge>
      )}
      {user.open_reports > 0 && (
        <Badge tone="danger">
          {user.open_reports}{" "}
          {t("báo cáo", user.open_reports === 1 ? "report" : "reports")}
        </Badge>
      )}
    </>
  );
}

export function UsersSection({
  params,
  setParams,
  onInspect,
}: {
  params: AdminParams;
  setParams: SetParams;
  onInspect: (user: AdminUser) => void;
}) {
  const { t, locale, date } = useAdminText();
  const [search, setSearch] = useState(params.q ?? "");
  const query = useDebounced(search);
  const page = parsePage(params.page);
  const status = (
    STATUSES.includes(params.status as AdminUserStatus) ? params.status : ""
  ) as AdminUserStatus;
  useEffect(() => {
    if (query !== (params.q ?? "")) setParams({ q: query });
    // Only a settled search text writes to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const { data, loading, failed } = useAdminData(
    (token) =>
      api.adminUsers(
        token,
        params.q ?? "",
        PAGE_SIZE,
        page * PAGE_SIZE,
        status,
      ),
    [params.q, page, status],
  );
  const labels: Record<AdminUserStatus, string> = {
    "": t("Tất cả", "All"),
    reported: t("Bị báo cáo", "Reported"),
    suspended: t("Đang khóa", "Suspended"),
    deleting: t("Chờ xóa", "Pending deletion"),
  };
  return (
    <section className="admin-panel">
      <div className="admin-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          label={t("Tìm kiếm", "Search")}
          clearLabel={t("Xóa tìm kiếm", "Clear search")}
          placeholder={t("Tên hoặc ID người dùng…", "User name or ID…")}
        />
        <div
          className="admin-segmented"
          role="group"
          aria-label={t("Lọc theo trạng thái", "Filter by status")}
        >
          {STATUSES.map((value) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={status === value}
              onClick={() => setParams({ status: value })}
            >
              {labels[value]}
            </button>
          ))}
        </div>
        <span className="admin-result-count" aria-live="polite">
          {(data?.total ?? 0).toLocaleString(locale)} {t("kết quả", "results")}
        </span>
      </div>
      {data ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">
              {t("Danh sách người dùng", "User list")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("Người dùng", "User")}</th>
                <th scope="col">{t("Trạng thái", "Status")}</th>
                <th scope="col">{t("Ngày tham gia", "Joined")}</th>
                <th scope="col">{t("Phòng đã tạo", "Rooms created")}</th>
                <th scope="col">
                  <span className="sr-only">{t("Thao tác", "Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <button
                      type="button"
                      className="admin-name"
                      onClick={() => onInspect(user)}
                    >
                      {user.display_name}
                    </button>
                    <span className="admin-sub mono">{user.id}</span>
                  </td>
                  <td>
                    <span className="admin-badges">
                      <UserBadges user={user} />
                      {!user.suspension &&
                        !user.deletion_scheduled_for &&
                        !user.open_reports && (
                          <span className="admin-sub">—</span>
                        )}
                    </span>
                  </td>
                  <td>
                    <time dateTime={user.created_at}>
                      {date(user.created_at)}
                    </time>
                  </td>
                  <td className="tabular-nums">{user.room_count}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-button"
                      onClick={() => onInspect(user)}
                      aria-label={`${t("Chi tiết", "Details")}: ${user.display_name}`}
                    >
                      {t("Chi tiết", "Details")}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && (
            <EmptyRow>
              {t("Không tìm thấy người dùng.", "No users found.")}
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
    </section>
  );
}
