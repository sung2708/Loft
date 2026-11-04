"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  DoorOpen,
  LayoutDashboard,
  Search,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { useAuth } from "@/lib/auth/useAuth";
import { ApiError, api } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AdminOverview, AdminRoom, AdminUser } from "@/types/api";

type Section = "overview" | "rooms" | "users";
const PAGE_SIZE = 25;

export default function AdminPage() {
  const { isAuthenticated, isLoading: authLoading, session, signInWithGoogle } = useAuth();
  const { locale } = useTranslation();
  const vi = locale === "vi";
  const token = session?.access_token;
  const [section, setSection] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [recentRooms, setRecentRooms] = useState<AdminRoom[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"request" | "forbidden" | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token || authLoading || !isAuthenticated) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (section === "overview") {
          const [summary, recent] = await Promise.all([
            api.adminOverview(token),
            api.adminRooms(token, "", 5, 0),
          ]);
          if (!controller.signal.aborted) {
            setOverview(summary);
            setRecentRooms(recent.items);
          }
        } else if (section === "users") {
          const result = await api.adminUsers(token, query, PAGE_SIZE, page * PAGE_SIZE);
          if (!controller.signal.aborted) {
            setUsers(result.items);
            setTotal(result.total);
          }
        } else {
          const result = await api.adminRooms(token, query, PAGE_SIZE, page * PAGE_SIZE);
          if (!controller.signal.aborted) {
            setRooms(result.items);
            setTotal(result.total);
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof ApiError && cause.status === 403 ? "forbidden" : "request");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [authLoading, isAuthenticated, page, query, section, token]);

  const copy = {
    admin: vi ? "Quản trị" : "Admin",
    overview: vi ? "Tổng quan" : "Overview",
    rooms: vi ? "Phòng" : "Rooms",
    users: vi ? "Người dùng" : "Users",
    totalRooms: vi ? "Tổng số phòng" : "Total rooms",
    totalUsers: vi ? "Tổng số người dùng" : "Total users",
    recentRooms: vi ? "Phòng mới tạo" : "Recently created rooms",
    created: vi ? "Ngày tạo" : "Created",
    owner: vi ? "Chủ phòng" : "Owner",
    access: vi ? "Quyền vào" : "Access",
    name: vi ? "Tên" : "Name",
    roomCount: vi ? "Phòng đã tạo" : "Rooms created",
    searchRooms: vi ? "Tìm phòng theo tên, mã hoặc chủ phòng" : "Search rooms by name, code, or owner",
    searchUsers: vi ? "Tìm người dùng theo tên hoặc ID" : "Search users by name or ID",
    empty: vi ? "Không tìm thấy kết quả." : "No results found.",
    loadError: vi ? "Không tải được dữ liệu. Hãy thử lại." : "Could not load data. Try again.",
    forbidden: vi ? "Tài khoản này chưa được cấp quyền quản trị." : "This account does not have admin access.",
    signIn: vi ? "Đăng nhập để tiếp tục." : "Sign in to continue.",
    signInAction: vi ? "Đăng nhập" : "Sign in",
    back: vi ? "Về Loft" : "Back to Loft",
    loading: vi ? "Đang tải…" : "Loading…",
    locked: vi ? "Đã khóa" : "Locked",
    open: vi ? "Đang mở" : "Open",
    ended: vi ? "Đã kết thúc" : "Ended",
    guests: vi ? "Cho phép khách" : "Guests allowed",
    membersOnly: vi ? "Chỉ thành viên" : "Members only",
    password: vi ? "Có mật khẩu" : "Password protected",
    noPassword: vi ? "Không mật khẩu" : "No password",
    resultCount: vi ? "kết quả" : "results",
    previous: vi ? "Trước" : "Previous",
    next: vi ? "Tiếp" : "Next",
    page: vi ? "Trang" : "Page",
    of: vi ? "/" : "of",
  };

  const nav: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: copy.overview, icon: LayoutDashboard },
    { id: "rooms", label: copy.rooms, icon: DoorOpen },
    { id: "users", label: copy.users, icon: Users },
  ];

  const date = (value: string) => new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

  return (
    <div className="app-canvas min-h-dvh text-[var(--text-loft-primary)]">
      <AppHeader
        fixed={false}
        title="Mingly"
        subtitle={copy.admin}
        actions={
          <>
            <LocaleToggle />
            <Link href="/" className="btn-press hover-invert inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[13px]">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">{copy.back}</span>
            </Link>
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-8 lg:py-8">
        <nav aria-label={copy.admin} className="flex shrink-0 gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-visible">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setSection(id); setPage(0); }}
              aria-current={section === id ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-3 rounded-[10px] px-3 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)] ${section === id ? "bg-[var(--bg-loft-surface)] font-medium text-[var(--text-loft-primary)]" : "text-[var(--text-loft-secondary)] hover:bg-[var(--bg-loft-surface)]"}`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
              {label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.03em]">{section === "overview" ? copy.admin : section === "rooms" ? copy.rooms : copy.users}</h1>
              {section === "overview" ? <p className="mt-1 text-[13px] text-[var(--text-loft-secondary)]">{vi ? "Tài khoản và phòng trong Loft" : "Accounts and rooms in Loft"}</p> : null}
            </div>
            {section !== "overview" ? (
              <label className="relative w-full sm:w-[min(100%,360px)]">
                <span className="sr-only">{section === "rooms" ? copy.searchRooms : copy.searchUsers}</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-loft-muted)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={section === "rooms" ? copy.searchRooms : copy.searchUsers}
                  className="h-11 w-full rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] pl-10 pr-3 text-[13px] text-[var(--text-loft-primary)] outline-none placeholder:text-[var(--text-loft-muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]/30"
                />
              </label>
            ) : null}
          </div>

          {!isAuthenticated && !authLoading ? (
            <section className="utility-panel rounded-[10px] p-6">
              <p className="text-[14px]">{copy.signIn}</p>
              <button type="button" onClick={() => void signInWithGoogle("/admin")} className="btn-press mt-4 inline-flex min-h-11 items-center rounded-[10px] bg-[#101113] px-4 text-[13px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]">
                {copy.signInAction}
              </button>
            </section>
          ) : authLoading || loading ? (
            <p role="status" className="py-8 text-[13px] text-[var(--text-loft-secondary)]">{copy.loading}</p>
          ) : error ? (
            <section role="alert" className="utility-panel rounded-[10px] p-6 text-[13px] text-[var(--text-loft-secondary)]">
              {error === "forbidden" ? copy.forbidden : copy.loadError}
            </section>
          ) : section === "overview" ? (
            <>
              <section aria-label={copy.overview} className="utility-panel grid grid-cols-2 overflow-hidden rounded-[10px]">
                <div className="border-r border-[var(--border-loft)] p-5 sm:p-6"> {/* taste-skill-ignore: divider keeps the two summary totals together */}
                  <p className="text-[13px] text-[var(--text-loft-secondary)]">{copy.totalUsers}</p>
                  <p className="mt-2 text-[28px] font-medium tabular-nums">{overview?.users ?? 0}</p>
                </div>
                <div className="p-5 sm:p-6">
                  <p className="text-[13px] text-[var(--text-loft-secondary)]">{copy.totalRooms}</p>
                  <p className="mt-2 text-[28px] font-medium tabular-nums">{overview?.rooms ?? 0}</p>
                </div>
              </section>

              <section aria-labelledby="recent-rooms-title" className="mt-8">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id="recent-rooms-title" className="text-[16px] font-medium">{copy.recentRooms}</h2>
                  <button type="button" onClick={() => setSection("rooms")} className="min-h-11 rounded-[10px] px-3 text-[13px] text-[var(--text-loft-secondary)] hover:bg-[var(--bg-loft-surface)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
                    {copy.rooms}
                  </button>
                </div>
                <RoomRows rooms={recentRooms} date={date} copy={copy} />
              </section>
            </>
          ) : section === "users" ? (
            <>
              <p className="mb-2 text-[13px] text-[var(--text-loft-secondary)]">{total} {copy.resultCount}</p>
              <UserRows users={users} date={date} copy={copy} />
              <Pager page={page} total={total} size={PAGE_SIZE} setPage={setPage} copy={copy} />
            </>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-[var(--text-loft-secondary)]">{total} {copy.resultCount}</p>
              <RoomRows rooms={rooms} date={date} copy={copy} detailed />
              <Pager page={page} total={total} size={PAGE_SIZE} setPage={setPage} copy={copy} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function RoomRows({
  rooms,
  date,
  copy,
  detailed = false,
}: {
  rooms: AdminRoom[];
  date: (value: string) => string;
  copy: Record<string, string>;
  detailed?: boolean;
}) {
  if (!rooms.length) return <p className="border-t border-[var(--border-loft)] py-6 text-[13px] text-[var(--text-loft-secondary)]">{copy.empty}</p>; // taste-skill-ignore: table section boundary
  return (
    <div className="border-t border-[var(--border-loft)]"> {/* taste-skill-ignore: this is a real data list */}
      {detailed ? (
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-4 py-3 text-[12px] text-[var(--text-loft-secondary)] md:grid">
          <span>{copy.name}</span><span>{copy.owner}</span><span>{copy.access}</span><span>{copy.created}</span>
        </div>
      ) : null}
      {rooms.map((room) => (
        <article key={room.id} className={detailed ? "grid gap-2 border-b border-[var(--border-loft)] py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:items-center md:gap-4" : "flex items-center justify-between gap-4 border-b border-[var(--border-loft)] py-3"}> {/* taste-skill-ignore: this is a real data list */}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{room.name}</p>
            <p className="mt-0.5 text-[12px] text-[var(--text-loft-secondary)]">{room.code} · {room.is_locked ? copy.locked : copy.open}</p>
          </div>
          {detailed ? <>
            <p className="truncate text-[13px] text-[var(--text-loft-secondary)]">{room.owner_name}<span className="ml-1 hidden text-[11px] lg:inline" title={room.owner_id}>· {room.owner_id.slice(0, 8)}</span></p>
            <p className="text-[12px] text-[var(--text-loft-secondary)]">{room.allow_guests ? copy.guests : copy.membersOnly}{room.password_required ? ` · ${copy.password}` : ` · ${copy.noPassword}`}</p>
            <div className="flex items-center justify-between gap-3 md:block">
              <time className="text-[12px] text-[var(--text-loft-secondary)]" dateTime={room.created_at}>{date(room.created_at)}</time>
              {room.ended ? <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-[var(--text-loft-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--text-loft-muted)]" />{copy.ended}</span> : null}
            </div>
          </> : <span className="shrink-0 text-[12px] text-[var(--text-loft-secondary)]">{date(room.created_at)}</span>}
        </article>
      ))}
    </div>
  );
}

function UserRows({
  users,
  date,
  copy,
}: {
  users: AdminUser[];
  date: (value: string) => string;
  copy: Record<string, string>;
}) {
  if (!users.length) return <p className="border-t border-[var(--border-loft)] py-6 text-[13px] text-[var(--text-loft-secondary)]">{copy.empty}</p>; // taste-skill-ignore: table section boundary
  return (
    <div className="border-t border-[var(--border-loft)]"> {/* taste-skill-ignore: this is a real data list */}
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-4 py-3 text-[12px] text-[var(--text-loft-secondary)] sm:grid">
        <span>{copy.name}</span><span>{copy.created}</span><span>{copy.roomCount}</span>
      </div>
      {users.map((user) => (
        <article key={user.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-[var(--border-loft)] py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)] sm:items-center sm:gap-4"> {/* taste-skill-ignore: this is a real data list */}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{user.display_name}</p>
            <p className="truncate text-[12px] text-[var(--text-loft-secondary)]" title={user.id}>{user.id}</p>
          </div>
          <time className="self-center text-[12px] text-[var(--text-loft-secondary)]" dateTime={user.created_at}>{date(user.created_at)}</time>
          <p className="col-span-2 text-[12px] text-[var(--text-loft-secondary)] sm:col-span-1">{copy.roomCount}: <span className="tabular-nums text-[var(--text-loft-primary)]">{user.room_count}</span></p>
        </article>
      ))}
    </div>
  );
}

function Pager({
  page,
  total,
  size,
  setPage,
  copy,
}: {
  page: number;
  total: number;
  size: number;
  setPage: (page: number) => void;
  copy: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages < 2) return null;
  return (
    <nav aria-label={copy.page} className="mt-5 flex items-center justify-end gap-2">
      <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} className="min-h-11 rounded-[10px] border border-[var(--border-loft)] px-3 text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)] disabled:opacity-50">{copy.previous}</button>
      <span className="px-1 text-[12px] text-[var(--text-loft-secondary)]">{copy.page} {page + 1} {copy.of} {pages}</span>
      <button type="button" onClick={() => setPage(page + 1)} disabled={page + 1 >= pages} className="min-h-11 rounded-[10px] border border-[var(--border-loft)] px-3 text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)] disabled:opacity-50">{copy.next}</button>
    </nav>
  );
}
