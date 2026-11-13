"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminRoom } from "@/types/api";
import {
  Badge,
  EmptyRow,
  PAGE_SIZE,
  Pagination,
  SearchBox,
  useAdminText,
  type AdminT,
} from "./shared";
import { useAdminData, useDebounced } from "./useAdminData";
import { Placeholder } from "./OverviewSection";
import { parsePage, type AdminParams, type SetParams } from "./params";

export function roomStatus(t: AdminT, room: AdminRoom) {
  return room.deleted
    ? t("Đã xóa", "Deleted")
    : room.moderation
      ? t("Đã xử lý vi phạm", "Moderated")
      : room.ended
        ? t("Đã kết thúc", "Ended")
        : room.is_locked
          ? t("Đã khóa", "Locked")
          : t("Chưa kết thúc", "Not ended");
}

export function RoomTable({
  rooms,
  onInspect,
}: {
  rooms: AdminRoom[];
  onInspect: (room: AdminRoom) => void;
}) {
  const { t, date } = useAdminText();
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="sr-only">
          {t("Danh sách phòng", "Room list")}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Phòng", "Room")}</th>
            <th scope="col">{t("Chủ phòng", "Owner")}</th>
            <th scope="col">{t("Trạng thái", "Status")}</th>
            <th scope="col">{t("Ngày", "Date")}</th>
            <th scope="col">
              <span className="sr-only">{t("Thao tác", "Actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => {
            const name = room.name || t("Phòng đã xóa", "Deleted room");
            return (
              <tr key={room.id}>
                <td>
                  <button
                    type="button"
                    className="admin-name"
                    onClick={() => onInspect(room)}
                  >
                    {name}
                  </button>
                  <span className="admin-sub mono">{room.code || room.id}</span>
                </td>
                <td>
                  <span className="admin-truncate">
                    {room.owner_name || "—"}
                  </span>
                  <span className="admin-sub">
                    {room.deleted
                      ? "—"
                      : room.allow_guests
                        ? t("Cho phép khách", "Guests allowed")
                        : t("Chỉ thành viên", "Members only")}
                  </span>
                </td>
                <td>
                  <Badge
                    tone={
                      room.moderation
                        ? "danger"
                        : room.ended
                          ? "neutral"
                          : "active"
                    }
                  >
                    {roomStatus(t, room)}
                  </Badge>
                </td>
                <td>
                  <time dateTime={room.created_at}>
                    {date(room.created_at)}
                  </time>
                </td>
                <td>
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => onInspect(room)}
                    aria-label={`${t("Chi tiết", "Details")}: ${name}`}
                  >
                    {t("Chi tiết", "Details")}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rooms.length && (
        <EmptyRow>{t("Không tìm thấy phòng.", "No rooms found.")}</EmptyRow>
      )}
    </div>
  );
}

export function RoomsSection({
  params,
  setParams,
  onInspect,
}: {
  params: AdminParams;
  setParams: SetParams;
  onInspect: (room: AdminRoom) => void;
}) {
  const { t, locale } = useAdminText();
  const [search, setSearch] = useState(params.q ?? "");
  const query = useDebounced(search);
  const page = parsePage(params.page);
  const status = params.status ?? "";
  useEffect(() => {
    if (query !== (params.q ?? "")) setParams({ q: query });
    // Only a settled search text writes to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const { data, loading, failed } = useAdminData(
    (token) =>
      api.adminRooms(
        token,
        params.q ?? "",
        PAGE_SIZE,
        page * PAGE_SIZE,
        status,
        params.owner ?? "",
      ),
    [params.q, page, status, params.owner],
  );
  return (
    <section className="admin-panel">
      <div className="admin-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          label={t("Tìm kiếm", "Search")}
          clearLabel={t("Xóa tìm kiếm", "Clear search")}
          placeholder={t(
            "Tên, mã phòng hoặc chủ phòng…",
            "Room name, code or owner…",
          )}
        />
        <select
          className="admin-select"
          aria-label={t("Trạng thái phòng", "Room status")}
          value={status}
          onChange={(e) => setParams({ status: e.target.value })}
        >
          <option value="">{t("Tất cả trạng thái", "All statuses")}</option>
          <option value="open">{t("Chưa kết thúc", "Not ended")}</option>
          <option value="moderated">
            {t("Đã xử lý vi phạm", "Moderated")}
          </option>
          <option value="ended">{t("Đã kết thúc", "Ended")}</option>
        </select>
        <span className="admin-result-count" aria-live="polite">
          {(data?.total ?? 0).toLocaleString(locale)} {t("kết quả", "results")}
        </span>
      </div>
      {params.owner && (
        <div className="admin-owner-filter">
          <span>
            {t("Chủ phòng", "Owner")}: {params.ownerName || params.owner}
          </span>
          <button
            type="button"
            className="admin-button"
            onClick={() => setParams({ owner: "", ownerName: "" })}
            aria-label={t("Bỏ lọc chủ phòng", "Clear owner filter")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {data ? (
        <RoomTable rooms={data.items} onInspect={onInspect} />
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
