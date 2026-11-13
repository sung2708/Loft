"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  DoorOpen,
  LayoutDashboard,
  RefreshCw,
  Search,
  ShieldCheck,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { useAuth } from "@/lib/auth/useAuth";
import { ApiError, api } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useUIStore } from "@/stores/useUIStore";
import type { AdminAuditEntry, AdminOverview, AdminRoom, AdminUser, CallQualitySummary } from "@/types/api";
import "./admin.css";

type Section = "overview" | "rooms" | "users" | "audit";
const PAGE_SIZE = 25;

const activeUserFor = (item: AdminRoom | AdminUser | null): item is AdminUser =>
  !!item && "display_name" in item;

export default function AdminPage() {
  const {
    isAuthenticated,
    isLoading: authLoading,
    session,
    signInWithGoogle,
  } = useAuth();
  const { locale } = useTranslation();
  const vi = locale === "vi";
  const t = (vn: string, en: string) => (vi ? vn : en);
  const token = session?.access_token;
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [section, setSection] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState<AdminUser | null>(null);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [quality, setQuality] = useState<CallQualitySummary | null>(null);
  const [suspendDays, setSuspendDays] = useState(7);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [total, setTotal] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"request" | "forbidden" | null>(null);
  const [selected, setSelected] = useState<AdminRoom | AdminUser | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const reasons = [
    ["illegal", t("Nghi vấn vi phạm pháp luật", "Suspected illegal activity")],
    ["policy", t("Vi phạm điều khoản", "Terms violation")],
    ["safety", t("Đe dọa, quấy rối", "Threats or harassment")],
    ["spam", t("Spam, lừa đảo", "Spam or scams")],
    ["other", t("Lý do khác", "Other")],
  ];
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token || authLoading || !isAuthenticated) return;
    let active = true;
    const load = async () => {
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError(null);
      try {
        if (section === "overview") {
          const [summary, recent, callQuality] = await Promise.all([
            api.adminOverview(token),
            api.adminRooms(token, "", 6),
            // Optional: the dashboard still loads if feedback is unavailable.
            api.adminCallQuality(token).catch(() => null),
          ]);
          if (active) {
            setOverview(summary);
            setRooms(recent.items);
            setQuality(callQuality);
          }
        } else if (section === "audit") {
          const result = await api.adminAudit(token, PAGE_SIZE, page * PAGE_SIZE);
          if (active) {
            setAudit(result.items);
            setTotal(result.total);
          }
        } else if (section === "users") {
          const result = await api.adminUsers(
            token,
            query,
            PAGE_SIZE,
            page * PAGE_SIZE,
          );
          if (active) {
            setUsers(result.items);
            setTotal(result.total);
          }
        } else {
          const result = await api.adminRooms(
            token,
            query,
            PAGE_SIZE,
            page * PAGE_SIZE,
            status,
            owner?.id,
          );
          if (active) {
            setRooms(result.items);
            setTotal(result.total);
          }
        }
        if (active) setUpdated(new Date());
      } catch (cause) {
        if (active)
          setError(
            cause instanceof ApiError && cause.status === 403
              ? "forbidden"
              : "request",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [
    authLoading,
    isAuthenticated,
    page,
    query,
    section,
    token,
    revision,
    status,
    owner?.id,
  ]);

  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);

  const navigate = (next: Section) => {
    setSection(next);
    setSearch("");
    setQuery("");
    setPage(0);
    setStatus("");
    setOwner(null);
  };
  const inspect = (item: AdminRoom | AdminUser) => {
    setSelected(item);
    setReason("");
    setNote("");
    setConfirmEnd(false);
    setConfirmSuspend(false);
    setSuspendDays(7);
    setActionError("");
    setNotice("");
  };
  const suspendUser = async () => {
    if (!activeUserFor(selected) || !token || pending || !reason || note.trim().length < 10) return;
    setPending(true);
    setActionError("");
    try {
      await api.adminSuspendUser(token, selected!.id, reason, note.trim(), suspendDays);
      setSelected(null);
      setRevision((v) => v + 1);
      setNotice(t("Đã tạm khóa tài khoản", "Account suspended"));
    } catch {
      setActionError(t("Không tạm khóa được. Hãy thử lại.", "Could not suspend. Try again."));
    } finally {
      setPending(false);
    }
  };
  const liftSuspension = async () => {
    if (!activeUserFor(selected) || !token || pending) return;
    setPending(true);
    setActionError("");
    try {
      await api.adminLiftSuspension(token, selected!.id);
      setSelected(null);
      setRevision((v) => v + 1);
      setNotice(t("Đã gỡ tạm khóa", "Suspension lifted"));
    } catch {
      setActionError(t("Không gỡ được. Hãy thử lại.", "Could not lift. Try again."));
    } finally {
      setPending(false);
    }
  };
  const auditAction = (action: string) =>
    ({
      "account.suspend": t("Tạm khóa tài khoản", "Suspended account"),
      "account.unsuspend": t("Gỡ tạm khóa", "Lifted suspension"),
      "room.end": t("Kết thúc phòng", "Ended room"),
    })[action] ?? action;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(t("Đã sao chép", "Copied"));
    } catch {
      setNotice(
        t(
          "Không sao chép được. Hãy chọn và sao chép thông tin bên dưới.",
          "Could not copy. Select and copy the information below.",
        ),
      );
    }
  };
  const endRoom = async () => {
    if (
      !selected ||
      !("code" in selected) ||
      !token ||
      pending ||
      !reason ||
      note.trim().length < 10
    )
      return;
    setPending(true);
    setActionError("");
    try {
      await api.adminEndRoom(token, selected.id, reason, note.trim());
      setSelected(null);
      setRevision((v) => v + 1);
      setNotice(t("Đã kết thúc phòng", "Room ended"));
    } catch (cause) {
      setActionError(
        cause instanceof ApiError && cause.code === "ROOM_END_MEDIA_PENDING"
          ? t(
              "Phòng đã kết thúc. Nhấn lại để thử ngắt cuộc gọi.",
              "Room ended. Retry to disconnect the call.",
            )
          : t(
              "Không kết thúc được phòng. Hãy thử lại.",
              "Could not end the room. Try again.",
            ),
      );
      setRevision((v) => v + 1);
    } finally {
      setPending(false);
    }
  };
  const roomStatus = (room: AdminRoom) =>
    room.deleted
      ? t("Đã xóa", "Deleted")
      : room.moderation
        ? t("Đã xử lý vi phạm", "Moderated")
        : room.ended
          ? t("Đã kết thúc", "Ended")
          : room.is_locked
            ? t("Đã khóa", "Locked")
            : t("Chưa kết thúc", "Not ended");
  const nav = [
    {
      id: "overview" as const,
      label: t("Tổng quan", "Overview"),
      icon: LayoutDashboard,
    },
    { id: "rooms" as const, label: t("Phòng", "Rooms"), icon: DoorOpen },
    { id: "users" as const, label: t("Người dùng", "Users"), icon: Users },
    { id: "audit" as const, label: t("Nhật ký", "Audit log"), icon: ScrollText },
  ];
  const activeRoom = selected && "code" in selected ? selected : null;
  const activeUser = selected && "display_name" in selected ? selected : null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const roomTable = () => (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="sr-only">
          {t("Danh sách phòng", "Room list")}
        </caption>
        <thead>
          <tr>
            <th>{t("Phòng", "Room")}</th>
            <th>{t("Chủ phòng", "Owner")}</th>
            <th>{t("Trạng thái", "Status")}</th>
            <th>{t("Ngày", "Date")}</th>
            <th>
              <span className="sr-only">{t("Thao tác", "Actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>
                <button className="admin-name" onClick={() => inspect(room)}>
                  {room.name || t("Phòng đã xóa", "Deleted room")}
                </button>
                <span className="admin-sub mono">{room.code || room.id}</span>
              </td>
              <td>
                <span className="admin-truncate">{room.owner_name || "—"}</span>
                <span className="admin-sub">
                  {room.deleted
                    ? "—"
                    : room.allow_guests
                      ? t("Cho phép khách", "Guests allowed")
                      : t("Chỉ thành viên", "Members only")}
                </span>
              </td>
              <td>
                <span
                  className={`admin-badge ${room.ended ? "" : "admin-badge-active"}`}
                >
                  <span />
                  {roomStatus(room)}
                </span>
              </td>
              <td>
                <time dateTime={room.created_at}>{date(room.created_at)}</time>
              </td>
              <td>
                <button
                  className="admin-button"
                  onClick={() => inspect(room)}
                  aria-label={`${t("Chi tiết", "Details")}: ${room.name || t("Phòng đã xóa", "Deleted room")}`}
                >
                  {t("Chi tiết", "Details")}
                  <ArrowUpRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rooms.length && (
        <p className="admin-empty">
          {t("Không tìm thấy phòng.", "No rooms found.")}
        </p>
      )}
    </div>
  );

  return (
    <div className="app-canvas admin-shell min-h-dvh text-[var(--text-loft-primary)]">
      <AppHeader
        fixed={false}
        title="Mingly"
        subtitle={t("Quản trị", "Admin")}
        actions={
          <>
            <label className="admin-theme">
              <span className="sr-only">{t("Giao diện", "Theme")}</span>
              <select
                aria-label={t("Giao diện", "Theme")}
                value={theme}
                onChange={(e) => setTheme(e.target.value as typeof theme)}
              >
                <option value="system">{t("Hệ thống", "System")}</option>
                <option value="light">{t("Sáng", "Light")}</option>
                <option value="dark">{t("Tối", "Dark")}</option>
              </select>
            </label>
            <LocaleToggle />
            <Link
              href="/"
              className="admin-button"
              aria-label={t("Về Mingly", "Back to Mingly")}
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Mingly</span>
            </Link>
          </>
        }
      />
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-workspace">
            <span className="admin-workspace-icon">
              <ShieldCheck size={19} />
            </span>
            <div>
              <strong>Mingly</strong>
              <span>{t("Quản trị viên", "Administrator")}</span>
            </div>
          </div>
          <nav aria-label={t("Quản trị", "Administration")}>
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                aria-current={section === id ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </nav>
          <p className="admin-sidebar-note">
            {t("Quản lý tài khoản và phòng", "Manage accounts and rooms")}
          </p>
        </aside>
        <main className="admin-main" id="admin-main">
          <header className="admin-page-heading">
            <div>
              <p className="admin-eyebrow">
                {t("KHÔNG GIAN QUẢN TRỊ", "ADMINISTRATION")}
              </p>
              <h1>{nav.find((n) => n.id === section)?.label}</h1>
              <p className="admin-updated">
                {updated
                  ? `${t("Cập nhật lúc", "Updated at")} ${updated.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`
                  : t("Tài khoản và phòng", "Accounts and rooms")}
              </p>
            </div>
            {isAuthenticated && (
              <button
                className="admin-button"
                disabled={loading || authLoading}
                onClick={() => setRevision((v) => v + 1)}
              >
                <RefreshCw
                  size={15}
                  className={
                    loading ? "animate-spin motion-reduce:animate-none" : ""
                  }
                />
                {t("Làm mới", "Refresh")}
              </button>
            )}
          </header>
          <p role="status" className={notice ? "admin-notice" : "sr-only"}>
            {notice}
          </p>
          {!isAuthenticated && !authLoading ? (
            <section className="admin-panel admin-empty">
              <ShieldCheck className="mx-auto mb-4" size={28} />
              <h2>{t("Đăng nhập để tiếp tục", "Sign in to continue")}</h2>
              <button
                className="admin-button admin-primary mt-4"
                onClick={() => void signInWithGoogle("/admin")}
              >
                {t("Đăng nhập", "Sign in")}
              </button>
            </section>
          ) : error ? (
            <section role="alert" className="admin-panel admin-empty">
              <p>
                {error === "forbidden"
                  ? t(
                      "Tài khoản này chưa được cấp quyền quản trị.",
                      "This account does not have admin access.",
                    )
                  : t("Không tải được dữ liệu.", "Could not load data.")}
              </p>
              {error === "request" && (
                <button
                  className="admin-button mt-4"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  {t("Thử lại", "Retry")}
                </button>
              )}
            </section>
          ) : (
            <div aria-busy={loading || authLoading}>
              {(loading && !updated) || authLoading ? (
                <div role="status" className="admin-panel admin-empty">
                  <RefreshCw
                    className="mx-auto mb-3 animate-spin motion-reduce:animate-none"
                    size={22}
                  />
                  {t("Đang tải…", "Loading…")}
                </div>
              ) : section === "overview" ? (
                <>
                  <section
                    className="admin-stats"
                    aria-label={t("Thống kê", "Statistics")}
                  >
                    {[
                      {
                        label: t("Người dùng", "Users"),
                        value: overview?.users,
                        detail: `+${overview?.new_users ?? 0} ${t("trong 7 ngày", "in 7 days")}`,
                        icon: Users,
                        section: "users" as const,
                        filter: "",
                      },
                      {
                        label: t("Tổng số phòng", "Total rooms"),
                        value: overview?.rooms,
                        detail: `+${overview?.new_rooms ?? 0} ${t("trong 7 ngày", "in 7 days")}`,
                        icon: DoorOpen,
                        section: "rooms" as const,
                        filter: "",
                      },
                      {
                        label: t("Chưa kết thúc", "Not ended"),
                        value: overview?.open_rooms,
                        detail: t("Xem danh sách phòng", "View room list"),
                        icon: LayoutDashboard,
                        section: "rooms" as const,
                        filter: "open",
                      },
                      {
                        label: t("Đã kết thúc", "Ended"),
                        value: overview?.ended_rooms,
                        detail: t("Xem lịch sử phòng", "View room history"),
                        icon: Check,
                        section: "rooms" as const,
                        filter: "ended",
                      },
                    ].map(
                      ({
                        label,
                        value,
                        detail,
                        icon: Icon,
                        section: next,
                        filter,
                      }) => (
                        <button
                          key={label}
                          className="admin-stat"
                          onClick={() => {
                            navigate(next);
                            setStatus(filter);
                          }}
                        >
                          <span className="admin-stat-top">
                            {label}
                            <Icon size={17} />
                          </span>
                          <strong>{(value ?? 0).toLocaleString(locale)}</strong>
                          <span className="admin-stat-bottom">
                            {detail}
                            <ArrowUpRight size={14} />
                          </span>
                        </button>
                      ),
                    )}
                  </section>
                  {quality && (
                    <section className="admin-panel">
                      <div className="admin-panel-heading">
                        <div>
                          <h2>{t("Chất lượng cuộc gọi", "Call quality")}</h2>
                          <p>{t("7 ngày gần nhất", "Last 7 days")}</p>
                        </div>
                      </div>
                      <dl className="admin-details">
                        <dt>{t("Lượt đánh giá", "Ratings")}</dt>
                        <dd className="tabular-nums">{quality.responses.toLocaleString(locale)}</dd>
                        <dt>{t("Điểm trung bình", "Average rating")}</dt>
                        <dd className="tabular-nums">
                          {quality.responses ? `${quality.average_rating.toFixed(2)} / 5` : "—"}
                        </dd>
                        <dt>{t("Đánh giá thấp (≤2)", "Low ratings (≤2)")}</dt>
                        <dd className="tabular-nums">{quality.low_ratings.toLocaleString(locale)}</dd>
                        <dt>{t("Thời gian mạng kém", "Time on poor network")}</dt>
                        <dd className="tabular-nums">{(quality.poor_share * 100).toFixed(1)}%</dd>
                        {Object.keys(quality.tags).length > 0 && (
                          <>
                            <dt>{t("Vấn đề hay gặp", "Reported issues")}</dt>
                            <dd>
                              {Object.entries(quality.tags)
                                .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                                .map(([tag, count]) => `${tag} (${count})`)
                                .join(" · ")}
                            </dd>
                          </>
                        )}
                      </dl>
                    </section>
                  )}
                  <section className="admin-panel">
                    <div className="admin-panel-heading">
                      <div>
                        <h2>{t("Phòng mới tạo", "Recently created rooms")}</h2>
                        <p>{t("6 phòng gần nhất", "6 most recent rooms")}</p>
                      </div>
                      <button
                        className="admin-button"
                        onClick={() => navigate("rooms")}
                      >
                        {t("Xem tất cả", "View all")}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                    {roomTable()}
                  </section>
                </>
              ) : (
                <section className="admin-panel">
                  <div className="admin-toolbar">
                    <label className="admin-search">
                      <Search size={17} />
                      <span className="sr-only">{t("Tìm kiếm", "Search")}</span>
                      <input
                        aria-label={t("Tìm kiếm", "Search")}
                        value={search}
                        maxLength={80}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={
                          section === "rooms"
                            ? t(
                                "Tên, mã phòng hoặc chủ phòng…",
                                "Room name, code or owner…",
                              )
                            : t("Tên hoặc ID người dùng…", "User name or ID…")
                        }
                      />
                      {search && (
                        <button
                          aria-label={t("Xóa tìm kiếm", "Clear search")}
                          onClick={() => {
                            setSearch("");
                            setQuery("");
                            setPage(0);
                          }}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </label>
                    {section === "rooms" && (
                      <select
                        className="admin-select"
                        aria-label={t("Trạng thái phòng", "Room status")}
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(0);
                        }}
                      >
                        <option value="">
                          {t("Tất cả trạng thái", "All statuses")}
                        </option>
                        <option value="open">
                          {t("Chưa kết thúc", "Not ended")}
                        </option>
                        <option value="moderated">
                          {t("Đã xử lý vi phạm", "Moderated")}
                        </option>
                        <option value="ended">
                          {t("Đã kết thúc", "Ended")}
                        </option>
                      </select>
                    )}
                    <span className="admin-result-count">
                      {total.toLocaleString(locale)} {t("kết quả", "results")}
                    </span>
                  </div>
                  {owner && section === "rooms" && (
                    <div className="admin-owner-filter">
                      <span>
                        {t("Chủ phòng", "Owner")}: {owner.display_name}
                      </span>
                      <button
                        className="admin-button"
                        onClick={() => {
                          setOwner(null);
                          setPage(0);
                        }}
                        aria-label={t("Bỏ lọc chủ phòng", "Clear owner filter")}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {section === "audit" ? (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <caption className="sr-only">{t("Nhật ký quản trị", "Admin audit log")}</caption>
                        <thead>
                          <tr>
                            <th>{t("Thao tác", "Action")}</th>
                            <th>{t("Đối tượng", "Target")}</th>
                            <th>{t("Người xử lý", "Administrator")}</th>
                            <th>{t("Thời điểm", "When")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {audit.map((entry) => (
                            <tr key={entry.id}>
                              <td>
                                <span className="admin-truncate">{auditAction(entry.action)}</span>
                                {entry.reason && (
                                  <span className="admin-sub">
                                    {reasons.find(([id]) => id === entry.reason)?.[1] ?? entry.reason}
                                  </span>
                                )}
                              </td>
                              <td>
                                <span className="admin-sub mono">{entry.target_id}</span>
                              </td>
                              <td>
                                <span className="admin-truncate">{entry.actor_name || "—"}</span>
                              </td>
                              <td>
                                <time dateTime={entry.created_at}>{date(entry.created_at)}</time>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!audit.length && (
                        <p className="admin-empty">{t("Chưa có thao tác nào.", "No actions yet.")}</p>
                      )}
                    </div>
                  ) : section === "rooms" ? (
                    roomTable()
                  ) : (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <caption className="sr-only">
                          {t("Danh sách người dùng", "User list")}
                        </caption>
                        <thead>
                          <tr>
                            <th>{t("Người dùng", "User")}</th>
                            <th>{t("Ngày tham gia", "Joined")}</th>
                            <th>{t("Phòng đã tạo", "Rooms created")}</th>
                            <th>
                              <span className="sr-only">
                                {t("Thao tác", "Actions")}
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((user) => (
                            <tr key={user.id}>
                              <td>
                                <button
                                  className="admin-name"
                                  onClick={() => inspect(user)}
                                >
                                  {user.display_name}
                                </button>
                                {user.suspension && (
                                  <span className="admin-badge ml-2">
                                    <span />
                                    {t("Tạm khóa", "Suspended")}
                                  </span>
                                )}
                                <span className="admin-sub mono">
                                  {user.id}
                                </span>
                              </td>
                              <td>
                                <time dateTime={user.created_at}>
                                  {date(user.created_at)}
                                </time>
                              </td>
                              <td className="tabular-nums">
                                {user.room_count}
                              </td>
                              <td>
                                <button
                                  className="admin-button"
                                  onClick={() => inspect(user)}
                                  aria-label={`${t("Chi tiết", "Details")}: ${user.display_name}`}
                                >
                                  {t("Chi tiết", "Details")}
                                  <ArrowUpRight size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!users.length && (
                        <p className="admin-empty">
                          {t("Không tìm thấy người dùng.", "No users found.")}
                        </p>
                      )}
                    </div>
                  )}
                  <nav
                    className="admin-pagination"
                    aria-label={t("Phân trang", "Pagination")}
                  >
                    <span>
                      {total ? page * PAGE_SIZE + 1 : 0}–
                      {Math.min((page + 1) * PAGE_SIZE, total)} / {total}
                    </span>
                    <div>
                      <button
                        className="admin-button"
                        disabled={!page}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        {t("Trước", "Previous")}
                      </button>
                      <span>
                        {page + 1} / {pages}
                      </span>
                      <button
                        className="admin-button"
                        disabled={page + 1 >= pages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        {t("Tiếp", "Next")}
                      </button>
                    </div>
                  </nav>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
      <dialog
        ref={dialog}
        className="admin-dialog"
        aria-labelledby="admin-detail-title"
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClose={() => {
          setSelected(null);
          setConfirmEnd(false);
        }}
      >
        {selected && (
          <>
            <div className="admin-detail-heading">
              <span className="admin-eyebrow">
                {activeRoom
                  ? t("CHI TIẾT PHÒNG", "ROOM DETAILS")
                  : t("CHI TIẾT TÀI KHOẢN", "ACCOUNT DETAILS")}
              </span>
              <button
                className="admin-button"
                disabled={pending}
                onClick={() => setSelected(null)}
                aria-label={t("Đóng", "Close")}
              >
                <X size={18} />
              </button>
            </div>
            <h2 id="admin-detail-title">
              {activeRoom
                ? activeRoom.name || t("Phòng đã xóa", "Deleted room")
                : activeUser?.display_name}
            </h2>
            <dl className="admin-details">
              <dt>ID</dt>
              <dd className="mono">
                {selected.id}
                <button
                  className="admin-button"
                  aria-label={t("Sao chép ID", "Copy ID")}
                  onClick={() => void copy(selected.id)}
                >
                  <Copy size={14} />
                </button>
              </dd>
              {activeRoom && !activeRoom.deleted ? (
                <>
                  <dt>{t("Mã phòng", "Room code")}</dt>
                  <dd className="mono">
                    {activeRoom.code}
                    <button
                      className="admin-button"
                      aria-label={t("Sao chép mã", "Copy code")}
                      onClick={() => void copy(activeRoom.code)}
                    >
                      <Copy size={14} />
                    </button>
                  </dd>
                  <dt>{t("Chủ phòng", "Owner")}</dt>
                  <dd>
                    {activeRoom.owner_name}
                    <span className="admin-sub mono">
                      {activeRoom.owner_id}
                    </span>
                  </dd>
                  <dt>{t("Trạng thái", "Status")}</dt>
                  <dd>{roomStatus(activeRoom)}</dd>
                  <dt>{t("Quyền vào", "Access")}</dt>
                  <dd>
                    {activeRoom.allow_guests
                      ? t("Cho phép khách", "Guests allowed")
                      : t("Chỉ thành viên", "Members only")}{" "}
                    ·{" "}
                    {activeRoom.password_required
                      ? t("Có mật khẩu", "Password protected")
                      : t("Không mật khẩu", "No password")}
                  </dd>
                </>
              ) : activeUser ? (
                <>
                  <dt>{t("Phòng đã tạo", "Rooms created")}</dt>
                  <dd>{activeUser?.room_count}</dd>
                  {activeUser.suspension && (
                    <>
                      <dt>{t("Tạm khóa đến", "Suspended until")}</dt>
                      <dd>
                        {activeUser.suspension.expires_at
                          ? date(activeUser.suspension.expires_at)
                          : t("Vĩnh viễn", "Permanent")}
                      </dd>
                      <dt>{t("Lý do", "Reason")}</dt>
                      <dd>
                        {reasons.find(([id]) => id === activeUser.suspension?.reason)?.[1] ??
                          activeUser.suspension.reason}
                      </dd>
                      <dt>{t("Ghi chú", "Note")}</dt>
                      <dd className="whitespace-pre-wrap">{activeUser.suspension.note}</dd>
                    </>
                  )}
                </>
              ) : null}
              <dt>
                {activeRoom?.deleted
                  ? t("Ngày xử lý", "Recorded")
                  : t("Ngày tạo", "Created")}
              </dt>
              <dd>{date(selected.created_at)}</dd>
            </dl>
            {notice && (
              <p role="status" className="admin-notice">
                {notice}
              </p>
            )}
            {activeUser && (
              <button
                className="admin-button admin-primary"
                onClick={() => {
                  navigate("rooms");
                  setOwner(activeUser);
                  setSelected(null);
                }}
              >
                {t("Xem phòng", "View rooms")}
                <ArrowUpRight size={15} />
              </button>
            )}
            {activeUser && (
              <div className="admin-danger-zone">
                {activeUser.suspension ? (
                  <button
                    className="admin-button"
                    disabled={pending}
                    onClick={() => void liftSuspension()}
                  >
                    {pending ? t("Đang gỡ…", "Lifting…") : t("Gỡ tạm khóa", "Lift suspension")}
                  </button>
                ) : confirmSuspend ? (
                  <>
                    <h3>{t("Tạm khóa tài khoản này?", "Suspend this account?")}</h3>
                    <p>
                      {t(
                        "Người dùng bị ngắt khỏi mọi phòng và không thể đăng nhập dùng dịch vụ cho đến khi hết hạn hoặc được gỡ.",
                        "The user is disconnected from every room and blocked until the suspension ends or is lifted.",
                      )}
                    </p>
                    <label className="block mb-4">
                      {t("Thời hạn", "Duration")}
                      <select
                        className="admin-select block w-full mt-2"
                        value={suspendDays}
                        disabled={pending}
                        onChange={(e) => setSuspendDays(Number(e.target.value))}
                      >
                        <option value={1}>{t("1 ngày", "1 day")}</option>
                        <option value={7}>{t("7 ngày", "7 days")}</option>
                        <option value={30}>{t("30 ngày", "30 days")}</option>
                        <option value={0}>{t("Vĩnh viễn", "Permanent")}</option>
                      </select>
                    </label>
                    <label className="block mb-4">
                      {t("Lý do xử lý", "Moderation reason")}
                      <select
                        className="admin-select block w-full mt-2"
                        value={reason}
                        disabled={pending}
                        onChange={(e) => setReason(e.target.value)}
                      >
                        <option value="">{t("Chọn lý do", "Select reason")}</option>
                        {reasons.map(([id, label]) => (
                          <option key={id} value={id}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block mb-4">
                      {t("Ghi chú xử lý", "Moderation note")}
                      <textarea
                        className="block w-full mt-2 rounded-lg border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[var(--text-loft-primary)]"
                        value={note}
                        disabled={pending}
                        minLength={10}
                        maxLength={1000}
                        rows={3}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button className="admin-button" disabled={pending} onClick={() => setConfirmSuspend(false)}>
                        {t("Hủy", "Cancel")}
                      </button>
                      <button
                        className="admin-button admin-danger"
                        disabled={pending || !reason || note.trim().length < 10}
                        onClick={() => void suspendUser()}
                      >
                        {pending ? t("Đang khóa…", "Suspending…") : t("Tạm khóa", "Suspend")}
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="admin-button admin-danger" onClick={() => setConfirmSuspend(true)}>
                    {t("Tạm khóa", "Suspend")}
                  </button>
                )}
                {actionError && <p role="alert">{actionError}</p>}
              </div>
            )}
            {activeRoom?.moderation && (
              <section
                className="admin-danger-zone"
                aria-label={t("Quyết định xử lý", "Moderation decision")}
              >
                <h3>{t("Đã xử lý vi phạm", "Moderation recorded")}</h3>
                <dl className="admin-details">
                  <dt>{t("Lý do", "Reason")}</dt>
                  <dd>
                    {reasons.find(
                      ([id]) => id === activeRoom.moderation?.reason,
                    )?.[1] ?? activeRoom.moderation.reason}
                  </dd>
                  <dt>{t("Ghi chú", "Note")}</dt>
                  <dd className="whitespace-pre-wrap">
                    {activeRoom.moderation.note}
                  </dd>
                  <dt>{t("Người xử lý", "Administrator")}</dt>
                  <dd className="mono">{activeRoom.moderation.actor_id}</dd>
                  <dt>{t("Thời điểm", "Recorded")}</dt>
                  <dd>{date(activeRoom.moderation.created_at)}</dd>
                </dl>
                <button
                  className="admin-button mt-4"
                  disabled={pending || activeRoom.deleted}
                  onClick={() => {
                    setReason(activeRoom.moderation!.reason);
                    setNote(activeRoom.moderation!.note);
                    setConfirmEnd(true);
                  }}
                >
                  {t("Thử ngắt lại", "Retry cleanup")}
                </button>
              </section>
            )}
            {activeRoom &&
              !activeRoom.deleted &&
              (!activeRoom.moderation || confirmEnd) && (
                <div className="admin-danger-zone">
                  {confirmEnd ? (
                    <>
                      <h3>{t("Kết thúc phòng này?", "End this room?")}</h3>
                      <p>
                        {t(
                          "Mọi người sẽ bị ngắt kết nối và không thể tham gia lại. Lịch sử phòng được giữ lại. Không thể hoàn tác.",
                          "Everyone will be disconnected and unable to rejoin. Room history is retained. This cannot be undone.",
                        )}
                      </p>
                      <label className="block mb-4">
                        {t("Lý do xử lý", "Moderation reason")}
                        <select
                          className="admin-select block w-full mt-2"
                          value={reason}
                          disabled={pending || !!activeRoom.moderation}
                          onChange={(e) => setReason(e.target.value)}
                        >
                          <option value="">
                            {t("Chọn lý do", "Select reason")}
                          </option>
                          {reasons.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block mb-4">
                        {t("Ghi chú xử lý", "Moderation note")}
                        <textarea
                          className="block w-full mt-2 rounded-lg border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[var(--text-loft-primary)]"
                          value={note}
                          disabled={pending || !!activeRoom.moderation}
                          minLength={10}
                          maxLength={1000}
                          rows={3}
                          onChange={(e) => setNote(e.target.value)}
                          aria-describedby="moderation-note-help"
                        />
                      </label>
                      <p id="moderation-note-help">
                        {t(
                          "10–1000 ký tự. Ghi hành vi và căn cứ xử lý; không nhập mật khẩu hoặc dữ liệu nhạy cảm.",
                          "10–1000 characters. Describe the conduct and basis for action; omit passwords and sensitive data.",
                        )}
                      </p>
                      <div className="flex gap-2">
                        <button
                          className="admin-button"
                          disabled={pending}
                          onClick={() => setConfirmEnd(false)}
                        >
                          {t("Hủy", "Cancel")}
                        </button>
                        <button
                          className="admin-button admin-danger"
                          disabled={
                            pending || !reason || note.trim().length < 10
                          }
                          onClick={() => void endRoom()}
                        >
                          {pending
                            ? t("Đang kết thúc…", "Ending…")
                            : t("Kết thúc phòng", "End room")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      className="admin-button admin-danger"
                      onClick={() => setConfirmEnd(true)}
                    >
                      {t("Kết thúc phòng", "End room")}
                    </button>
                  )}
                  {actionError && <p role="alert">{actionError}</p>}
                </div>
              )}
          </>
        )}
      </dialog>
    </div>
  );
}
