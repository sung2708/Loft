"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  DoorOpen,
  Flag,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { useAuth, useAuthStore } from "@/lib/auth/useAuth";
import { useUIStore } from "@/stores/useUIStore";
import { useAdminText } from "./shared";
import {
  AdminSessionContext,
  type AdminGateError,
  type AdminSession,
} from "./useAdminData";
import {
  parseSection,
  type AdminParams,
  type Navigate,
  type Section,
  type SetParams,
} from "./params";
import { OverviewSection } from "./OverviewSection";
import { RoomsSection } from "./RoomsSection";
import { UsersSection } from "./UsersSection";
import { ReportsSection } from "./ReportsSection";
import { AuditSection } from "./AuditSection";
import { AdminDialog, type Inspecting } from "./Dialogs";
import { MfaGate } from "./MfaGate";
import "@/app/admin/admin.css";

const PARAM_KEYS = [
  "q",
  "status",
  "owner",
  "ownerName",
  "page",
  "action",
  "actor",
  "target",
  "from",
  "to",
] as const;

export function AdminPage({ homeHref }: { homeHref: string }) {
  const {
    isAuthenticated,
    isLoading: authLoading,
    session,
    signInWithGoogle,
    signOut,
  } = useAuth();
  const { t } = useAdminText();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const token = session?.access_token;
  const section = parseSection(search.get("section"));
  const params = useMemo(() => {
    const value: AdminParams = {};
    for (const key of PARAM_KEYS) {
      const item = search.get(key);
      if (item) value[key] = item;
    }
    return value;
  }, [search]);

  const [revision, setRevision] = useState(0);
  const [gate, setGate] = useState<AdminGateError | null>(null);
  const [notice, setNotice] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [inspecting, setInspecting] = useState<Inspecting | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setNotice("");
    try {
      await signOut();
    } catch {
      setNotice(
        useAuthStore.getState().authState.status === "anonymous"
          ? t("Đã đăng xuất trên trình duyệt. Máy chủ chưa xác nhận kết thúc phiên.", "Signed out in this browser. The server could not confirm the session ended.")
          : t("Không thể đăng xuất. Vui lòng thử lại.", "Could not sign out. Try again."),
      );
    } finally {
      if (useAuthStore.getState().authState.status === "anonymous") {
        setGate(null);
        setInspecting(null);
      }
      setSigningOut(false);
    }
  }

  const write = useCallback(
    (next: Section, nextParams: AdminParams) => {
      const query = new URLSearchParams();
      if (next !== "overview") query.set("section", next);
      for (const key of PARAM_KEYS)
        if (nextParams[key]) query.set(key, nextParams[key]!);
      const text = query.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );
  const navigate = useCallback<Navigate>(
    (next, nextParams = {}) => {
      setNotice("");
      write(next, nextParams);
    },
    [write],
  );
  // Any filter change returns to the first page unless the change is the page itself.
  const setParams = useCallback<SetParams>(
    (patch, options) =>
      write(section, {
        ...params,
        ...(options?.keepPage ? {} : { page: "" }),
        ...patch,
      }),
    [params, section, write],
  );

  const adminSession = useMemo<AdminSession | null>(
    () =>
      token
        ? {
            token,
            revision,
            refresh: () => setRevision((value) => value + 1),
            reportGate: setGate,
            notify: setNotice,
          }
        : null,
    [revision, token],
  );

  const nav: Array<{ id: Section; label: string; icon: typeof Users }> = [
    {
      id: "overview",
      label: t("Tổng quan", "Overview"),
      icon: LayoutDashboard,
    },
    { id: "reports", label: t("Báo cáo", "Reports"), icon: Flag },
    { id: "rooms", label: t("Phòng", "Rooms"), icon: DoorOpen },
    { id: "users", label: t("Người dùng", "Users"), icon: Users },
    { id: "audit", label: t("Nhật ký", "Audit log"), icon: ScrollText },
  ];
  const inspectRoom = (id: string) => setInspecting({ kind: "room", id });
  const inspectUser = (id: string, name: string) =>
    setInspecting({ kind: "user", id, name });

  let content: React.ReactNode;
  if (authLoading) {
    content = (
      <div role="status" className="admin-panel admin-empty">
        {t("Đang tải…", "Loading…")}
      </div>
    );
  } else if (!isAuthenticated || !adminSession) {
    content = (
      <section className="admin-panel admin-empty">
        <ShieldCheck className="mx-auto mb-4" size={28} aria-hidden="true" />
        <h2>{t("Đăng nhập để tiếp tục", "Sign in to continue")}</h2>
        <button
          type="button"
          className="admin-button admin-primary mt-4"
          onClick={() => void signInWithGoogle("/admin")}
        >
          {t("Đăng nhập", "Sign in")}
        </button>
      </section>
    );
  } else if (gate === "forbidden") {
    content = (
      <section role="alert" className="admin-panel admin-empty">
        {t(
          "Tài khoản này chưa được cấp quyền quản trị.",
          "This account does not have admin access.",
        )}
      </section>
    );
  } else if (gate === "mfa") {
    content = (
      <MfaGate
        onVerified={() => {
          setGate(null);
          setRevision((value) => value + 1);
        }}
      />
    );
  } else {
    const key = `${section}`;
    content =
      section === "overview" ? (
        <OverviewSection
          key={key}
          navigate={navigate}
          onInspectRoom={(room) =>
            setInspecting({ kind: "room", room, id: room.id })
          }
        />
      ) : section === "reports" ? (
        <ReportsSection
          key={key}
          params={params}
          setParams={setParams}
          onInspectUser={inspectUser}
          onInspectRoom={inspectRoom}
        />
      ) : section === "rooms" ? (
        <RoomsSection
          key={key}
          params={params}
          setParams={setParams}
          onInspect={(room) =>
            setInspecting({ kind: "room", room, id: room.id })
          }
        />
      ) : section === "users" ? (
        <UsersSection
          key={key}
          params={params}
          setParams={setParams}
          onInspect={(user) => inspectUser(user.id, user.display_name)}
        />
      ) : (
        <AuditSection
          key={key}
          params={params}
          setParams={setParams}
          onInspectTarget={(type, id) =>
            type === "room" ? inspectRoom(id) : inspectUser(id, id.slice(0, 8))
          }
        />
      );
  }

  return (
    <div className="app-canvas admin-shell min-h-dvh text-[var(--text-loft-primary)]">
      <AppHeader
        fixed={false}
        homeHref={homeHref}
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
              href={homeHref}
              className="admin-button"
              aria-label={t("Về Mingly", "Back to Mingly")}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Mingly</span>
            </Link>
            {isAuthenticated && (
              <button
                type="button"
                className="admin-button"
                aria-label={t("Đăng xuất", "Sign out")}
                disabled={signingOut}
                onClick={handleSignOut}
              >
                <LogOut size={16} aria-hidden="true" />
                <span className="hidden sm:inline">{t("Đăng xuất", "Sign out")}</span>
              </button>
            )}
          </>
        }
      />
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-workspace">
            <span className="admin-workspace-icon">
              <ShieldCheck size={19} aria-hidden="true" />
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
                type="button"
                onClick={() => navigate(id)}
                aria-current={section === id ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="admin-main" id="admin-main">
          <header className="admin-page-heading">
            <div>
              <p className="admin-eyebrow">
                {t("KHÔNG GIAN QUẢN TRỊ", "ADMINISTRATION")}
              </p>
              <h1>{nav.find((item) => item.id === section)?.label}</h1>
            </div>
            {adminSession && gate !== "mfa" && (
              <button
                type="button"
                className="admin-button"
                onClick={() => {
                  // Access may have been granted since; ask the server again.
                  setGate(null);
                  setRevision((value) => value + 1);
                }}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {t("Làm mới", "Refresh")}
              </button>
            )}
          </header>
          <p role="status" className={notice ? "admin-notice" : "sr-only"}>
            {notice}
          </p>
          {adminSession ? (
            <AdminSessionContext.Provider value={adminSession}>
              {content}
            </AdminSessionContext.Provider>
          ) : (
            content
          )}
        </main>
      </div>
      {adminSession && (
        <AdminSessionContext.Provider value={adminSession}>
          <AdminDialog
            inspecting={inspecting}
            busy={false}
            onClose={() => setInspecting(null)}
            navigate={navigate}
          />
        </AdminSessionContext.Provider>
      )}
    </div>
  );
}
