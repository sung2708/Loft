"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, LogOut, MonitorSmartphone } from "lucide-react";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { Switch } from "@/components/ui/Switch";
import { ApiError, api, clearRoomCredentials } from "@/lib/api";
import { useAuth, useAuthStore } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { getSupabase } from "@/lib/supabase/client";
import {
  useMediaPrefsStore,
  type ScreenShareMode,
} from "@/stores/useMediaPrefsStore";
import { useUIStore } from "@/stores/useUIStore";
import type { AccountProfile } from "@/types/api";

const SECTIONS = [
  "profile",
  "calls",
  "appearance",
  "security",
  "data",
] as const;

export default function SettingsPage() {
  const {
    isAuthenticated,
    isLoading,
    session,
    user,
    signInWithGoogle,
    signOut,
  } = useAuth();
  const router = useRouter();
  const { locale } = useTranslation();
  const vi = locale === "vi";
  const t = (vn: string, en: string) => (vi ? vn : en);
  const token = session?.access_token;
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .account(token)
      .then((value) => active && setAccount(value))
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [token]);

  const labels: Record<(typeof SECTIONS)[number], string> = {
    profile: t("Hồ sơ", "Profile"),
    calls: t("Cuộc gọi", "Calls"),
    appearance: t("Giao diện", "Appearance"),
    security: t("Đăng nhập", "Sign-in"),
    data: t("Dữ liệu", "Your data"),
  };

  return (
    <main className="app-canvas page-scroll min-h-dvh text-[var(--text-loft-primary)]">
      <LobbyHeader />
      <div aria-hidden="true" className="h-14" />
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href="/home"
          className="btn-press hover-invert inline-flex min-h-10 w-fit items-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[13px]"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {t("Phòng của bạn", "Your rooms")}
        </Link>
        <div className="mt-10">
          <p className="eyebrow">{t("Tài khoản", "Account")}</p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.05em]">
            {t("Cài đặt", "Settings")}
          </h1>
        </div>

        {isLoading ? (
          <p
            role="status"
            className="mt-10 text-[13px] text-[var(--text-loft-secondary)]"
          >
            {t("Đang tải…", "Loading…")}
          </p>
        ) : !isAuthenticated || !token ? (
          <section className="utility-panel mt-10 rounded-[10px] p-6">
            <p className="text-[13px] text-[var(--text-loft-secondary)]">
              {t(
                "Đăng nhập để quản lý tài khoản.",
                "Sign in to manage your account.",
              )}
            </p>
            <button
              type="button"
              onClick={() => void signInWithGoogle("/settings")}
              className="btn-press mt-4 min-h-11 rounded-[10px] bg-[#101113] px-4 text-[13px] font-medium text-white dark:bg-[#f4f5f7] dark:text-[#101113]"
            >
              {t("Đăng nhập", "Sign in")}
            </button>
            <div className="mt-8 grid gap-6">
              <CallSettings vi={vi} />
              <AppearanceSettings vi={vi} />
            </div>
          </section>
        ) : (
          <div className="mt-10 grid gap-10 lg:grid-cols-[180px_minmax(0,1fr)]">
            <nav
              aria-label={t("Mục cài đặt", "Settings sections")}
              className="lg:sticky lg:top-24 lg:self-start"
            >
              <ul className="flex gap-1 overflow-x-auto lg:flex-col">
                {SECTIONS.map((id) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="hover-invert flex min-h-10 items-center whitespace-nowrap rounded-[10px] px-3 text-[13px] text-[var(--text-loft-secondary)]"
                    >
                      {labels[id]}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="grid min-w-0 gap-6">
              {loadFailed && (
                <p
                  role="alert"
                  className="rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 py-3 text-[13px]"
                >
                  {t(
                    "Không tải được thông tin tài khoản. Tải lại trang để thử lại.",
                    "Could not load your account. Reload the page to try again.",
                  )}
                </p>
              )}
              <ProfileSettings
                key={account?.id ?? "loading"}
                vi={vi}
                token={token}
                account={account}
                providerName={
                  (user?.user_metadata?.full_name as string | undefined) ??
                  (user?.user_metadata?.name as string | undefined) ??
                  ""
                }
                providerAvatar={
                  (user?.user_metadata?.avatar_url as string | undefined) ?? ""
                }
                onSaved={(next) => {
                  setAccount(next);
                  // Keep the signed-in identity in step without another round trip.
                  useAuthStore.setState((state) =>
                    state.authState.status === "authenticated" &&
                    state.authState.identity
                      ? {
                          authState: {
                            ...state.authState,
                            identity: {
                              ...state.authState.identity,
                              display_name: next.display_name,
                              avatar_url: next.avatar_url,
                            },
                          },
                        }
                      : state,
                  );
                }}
              />
              <CallSettings vi={vi} />
              <AppearanceSettings vi={vi} />
              <SignInSettings
                vi={vi}
                email={user?.email ?? ""}
                onSignOut={async () => {
                  await signOut();
                  router.replace("/");
                }}
              />
              <DataSettings
                vi={vi}
                token={token}
                account={account}
                onChange={(scheduledFor) =>
                  setAccount((current) =>
                    current
                      ? { ...current, deletion_scheduled_for: scheduledFor }
                      : current,
                  )
                }
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Panel({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? title}-title`}
      className="utility-panel scroll-mt-24 overflow-hidden rounded-[10px]"
    >
      <div className="border-b border-[var(--border-loft)] px-5 py-4">
        <h2 id={`${id ?? title}-title`} className="text-base font-medium">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[13px] text-[var(--text-loft-secondary)]">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border-loft)] p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm">
            {label}
          </label>
        ) : (
          <p className="text-sm">{label}</p>
        )}
        {hint && (
          <p className="mt-1 text-[13px] text-[var(--text-loft-muted)]">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const inputClass =
  "min-h-11 w-full rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 text-sm text-[var(--text-loft-primary)] outline-none placeholder:text-[var(--text-loft-muted)] focus:ring-2 focus:ring-[var(--accent-blue)]";
const primaryButton =
  "btn-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[#101113] px-4 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#f4f5f7] dark:text-[#101113]";
const secondaryButton =
  "btn-press hover-invert inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton =
  "btn-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[#b42318]/50 px-4 text-[13px] font-medium text-[#b42318] hover:bg-[#b42318]/[0.06] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#ff9b91]/50 dark:text-[#ff9b91] dark:hover:bg-[#ff9b91]/[0.08]";

function ProfileSettings({
  vi,
  token,
  account,
  providerName,
  providerAvatar,
  onSaved,
}: {
  vi: boolean;
  token: string;
  account: AccountProfile | null;
  providerName: string;
  providerAvatar: string;
  onSaved: (account: AccountProfile) => void;
}) {
  const t = (vn: string, en: string) => (vi ? vn : en);
  // The parent remounts this form once the account loads (key = account id).
  const [name, setName] = useState(account?.custom_display_name ?? "");
  const [hideAvatar, setHideAvatar] = useState(account?.hide_avatar ?? false);
  const [state, setState] = useState<
    "idle" | "saving" | "saved" | "error" | "invalid"
  >("idle");
  const trimmed = name.trim().replace(/\s+/g, " ");
  const dirty =
    Boolean(account) &&
    (trimmed !== (account?.custom_display_name ?? "") ||
      hideAvatar !== account?.hide_avatar);
  const tooShort =
    trimmed.length > 0 && (trimmed.length < 2 || trimmed.length > 48);
  const shownName = trimmed || providerName || account?.display_name || "";
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dirty || tooShort) return;
    setState("saving");
    try {
      const next = await api.updateAccount(token, {
        display_name: trimmed || null,
        hide_avatar: hideAvatar,
      });
      onSaved(next);
      setState("saved");
    } catch (cause) {
      setState(
        cause instanceof ApiError && cause.code === "INVALID_DISPLAY_NAME"
          ? "invalid"
          : "error",
      );
    }
  };
  return (
    <Panel
      id="profile"
      title={t("Hồ sơ", "Profile")}
      description={t(
        "Cách người khác thấy bạn trong phòng.",
        "How other people see you in rooms.",
      )}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="flex items-center gap-4 border-b border-[var(--border-loft)] p-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-loft)] bg-[var(--border-loft-light)] text-lg font-medium">
            {providerAvatar && !hideAvatar ? (
              <img
                src={providerAvatar}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              (shownName.slice(0, 1) || "?").toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{shownName || "—"}</p>
            <p className="text-[13px] text-[var(--text-loft-muted)]">
              {t("Xem trước", "Preview")}
            </p>
          </div>
        </div>
        <div className="border-b border-[var(--border-loft)] p-5">
          <label htmlFor="display-name" className="block text-sm">
            {t("Tên hiển thị", "Display name")}
          </label>
          <input
            id="display-name"
            value={name}
            maxLength={48}
            disabled={!account}
            onChange={(event) => {
              setName(event.target.value);
              setState("idle");
            }}
            placeholder={providerName || t("Tên từ Google", "Your Google name")}
            aria-describedby="display-name-help"
            aria-invalid={tooShort}
            className={`${inputClass} mt-2 max-w-md`}
          />
          <p
            id="display-name-help"
            className="mt-2 text-[13px] text-[var(--text-loft-muted)]"
          >
            {tooShort
              ? t("Tên cần 2–48 ký tự.", "Names need 2–48 characters.")
              : t(
                  "Để trống để dùng tên tài khoản Google. Áp dụng khi bạn vào phòng lần tới.",
                  "Leave empty to use your Google name. Applies the next time you join a room.",
                )}
          </p>
        </div>
        <Row
          label={t("Ẩn ảnh đại diện", "Hide profile photo")}
          hint={t(
            "Hiện chữ cái đầu thay cho ảnh Google.",
            "Show your initial instead of your Google photo.",
          )}
        >
          <Switch
            checked={hideAvatar}
            disabled={!account}
            label={t("Ẩn ảnh đại diện", "Hide profile photo")}
            onChange={(value) => {
              setHideAvatar(value);
              setState("idle");
            }}
          />
        </Row>
        <div className="flex flex-wrap items-center justify-end gap-3 p-5">
          <p
            role="status"
            className="text-[13px] text-[var(--text-loft-secondary)]"
          >
            {state === "saved"
              ? t("Đã lưu", "Saved")
              : state === "error"
                ? t(
                    "Không lưu được. Hãy thử lại.",
                    "Could not save. Try again.",
                  )
                : state === "invalid"
                  ? t("Tên cần 2–48 ký tự.", "Names need 2–48 characters.")
                  : ""}
          </p>
          <button
            type="submit"
            disabled={!dirty || tooShort || state === "saving"}
            className={primaryButton}
          >
            {state === "saving" ? t("Đang lưu…", "Saving…") : t("Lưu", "Save")}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function CallSettings({ vi }: { vi: boolean }) {
  const t = (vn: string, en: string) => (vi ? vn : en);
  const prefs = useMediaPrefsStore();
  const hydrate = useMediaPrefsStore((state) => state.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return (
    <Panel
      id="calls"
      title={t("Cuộc gọi", "Calls")}
      description={t(
        "Mặc định khi vào phòng. Chỉ lưu trên trình duyệt này.",
        "Defaults when you join. Saved in this browser only.",
      )}
    >
      <Row label={t("Bật micro khi vào phòng", "Microphone on when joining")}>
        <Switch
          checked={prefs.micOnJoin}
          label={t("Bật micro khi vào phòng", "Microphone on when joining")}
          onChange={(micOnJoin) => prefs.update({ micOnJoin })}
        />
      </Row>
      <Row label={t("Bật camera khi vào phòng", "Camera on when joining")}>
        <Switch
          checked={prefs.cameraOnJoin}
          label={t("Bật camera khi vào phòng", "Camera on when joining")}
          onChange={(cameraOnJoin) => prefs.update({ cameraOnJoin })}
        />
      </Row>
      <Row
        label={t("Nhấn để nói", "Push to talk")}
        hint={t("Giữ phím Space để nói.", "Hold Space to talk.")}
      >
        <Switch
          checked={prefs.pushToTalk}
          label={t("Nhấn để nói", "Push to talk")}
          onChange={(pushToTalk) => prefs.update({ pushToTalk })}
        />
      </Row>
      <Row
        label={t("Chia sẻ màn hình", "Screen sharing")}
        hint={t(
          "Nét: chữ và slide rõ. Mượt: video chuyển động mượt hơn.",
          "Detail keeps text and slides sharp. Motion keeps video smooth.",
        )}
        htmlFor="screen-share-mode"
      >
        <select
          id="screen-share-mode"
          value={prefs.screenShareMode}
          onChange={(event) =>
            prefs.update({
              screenShareMode: event.target.value as ScreenShareMode,
            })
          }
          className="min-h-11 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-sm"
        >
          <option value="detail">{t("Nét", "Detail")}</option>
          <option value="motion">{t("Mượt", "Motion")}</option>
        </select>
      </Row>
    </Panel>
  );
}

function AppearanceSettings({ vi }: { vi: boolean }) {
  const t = (vn: string, en: string) => (vi ? vn : en);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  return (
    <Panel id="appearance" title={t("Giao diện", "Appearance")}>
      <Row label={t("Chủ đề", "Theme")} htmlFor="account-theme">
        <select
          id="account-theme"
          value={theme}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "system" || next === "light" || next === "dark")
              setTheme(next);
          }}
          className="min-h-11 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-sm"
        >
          <option value="system">{t("Theo hệ thống", "System")}</option>
          <option value="light">{t("Sáng", "Light")}</option>
          <option value="dark">{t("Tối", "Dark")}</option>
        </select>
      </Row>
      <Row label={t("Ngôn ngữ", "Language")}>
        <LocaleToggle />
      </Row>
    </Panel>
  );
}

function SignInSettings({
  vi,
  email,
  onSignOut,
}: {
  vi: boolean;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const t = (vn: string, en: string) => (vi ? vn : en);
  const router = useRouter();
  const [pending, setPending] = useState<"here" | "everywhere" | null>(null);
  const [failed, setFailed] = useState(false);
  const signOutEverywhere = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setPending("everywhere");
    setFailed(false);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      setPending(null);
      setFailed(true);
      return;
    }
    clearRoomCredentials();
    useAuthStore.setState({ authState: { status: "anonymous" } });
    router.replace("/");
  };
  return (
    <Panel id="security" title={t("Đăng nhập", "Sign-in")}>
      <Row
        label={t("Tài khoản Google", "Google account")}
        hint={email || undefined}
      >
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => {
            setPending("here");
            void onSignOut().catch(() => {
              setPending(null);
              setFailed(true);
            });
          }}
          className={secondaryButton}
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          {pending === "here"
            ? t("Đang đăng xuất…", "Signing out…")
            : t("Đăng xuất", "Sign out")}
        </button>
      </Row>
      <Row
        label={t("Đăng xuất mọi thiết bị", "Sign out everywhere")}
        hint={t(
          "Dùng khi bạn đăng nhập trên máy khác hoặc nghi bị lộ tài khoản. Phiên trên thiết bị khác hết hạn trong vòng 1 giờ.",
          "Use this if you signed in on another device or think your account is exposed. Other sessions end within an hour.",
        )}
      >
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void signOutEverywhere()}
          className={secondaryButton}
        >
          <MonitorSmartphone aria-hidden="true" className="h-4 w-4" />
          {pending === "everywhere"
            ? t("Đang đăng xuất…", "Signing out…")
            : t("Đăng xuất tất cả", "Sign out all")}
        </button>
      </Row>
      {failed && (
        <p
          role="alert"
          className="px-5 pb-5 text-[13px] text-[#b42318] dark:text-[#ff9b91]"
        >
          {t(
            "Không đăng xuất được. Hãy thử lại.",
            "Could not sign out. Try again.",
          )}
        </p>
      )}
    </Panel>
  );
}

function DataSettings({
  vi,
  token,
  account,
  onChange,
}: {
  vi: boolean;
  token: string;
  account: AccountProfile | null;
  onChange: (scheduledFor: string | null) => void;
}) {
  const t = (vn: string, en: string) => (vi ? vn : en);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const word = t("XÓA", "DELETE");
  const scheduled = account?.deletion_scheduled_for;
  const when = scheduled
    ? new Intl.DateTimeFormat(vi ? "vi" : "en", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(scheduled))
    : "";

  const download = async () => {
    setExporting(true);
    setExportError("");
    try {
      await api.exportAccount(token);
    } catch (cause) {
      setExportError(
        cause instanceof ApiError && cause.code === "RATE_LIMITED"
          ? t(
              "Bạn đã tải nhiều lần. Hãy thử lại sau ít phút.",
              "You've downloaded several times. Try again in a few minutes.",
            )
          : t("Không tải được. Hãy thử lại.", "Could not download. Try again."),
      );
    } finally {
      setExporting(false);
    }
  };
  const schedule = async () => {
    if (typed.trim().toLocaleUpperCase(vi ? "vi" : "en") !== word || pending)
      return;
    setPending(true);
    setError("");
    try {
      const result = await api.scheduleAccountDeletion(token);
      onChange(result.deletion_scheduled_for);
      setConfirming(false);
      setTyped("");
    } catch {
      setError(
        t(
          "Không lên lịch xóa được. Hãy thử lại.",
          "Could not schedule deletion. Try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  };
  const cancel = async () => {
    setPending(true);
    setError("");
    try {
      await api.cancelAccountDeletion(token);
      onChange(null);
    } catch {
      setError(
        t("Không hủy được. Hãy thử lại.", "Could not cancel. Try again."),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      id="data"
      title={t("Dữ liệu", "Your data")}
      description={t(
        "Tải bản sao hoặc xóa tài khoản.",
        "Download a copy or delete your account.",
      )}
    >
      <Row
        label={t("Tải dữ liệu của bạn", "Download your data")}
        hint={t(
          "Tệp JSON gồm hồ sơ, phòng, tin nhắn bạn đã gửi (tối đa 10.000 tin gần nhất) và đánh giá cuộc gọi.",
          "A JSON file with your profile, rooms, messages you sent (newest 10,000) and call ratings.",
        )}
      >
        <button
          type="button"
          disabled={exporting}
          onClick={() => void download()}
          className={secondaryButton}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {exporting
            ? t("Đang chuẩn bị…", "Preparing…")
            : t("Tải xuống", "Download")}
        </button>
      </Row>
      {exportError && (
        <p
          role="alert"
          className="border-b border-[var(--border-loft)] px-5 pb-5 text-[13px] text-[#b42318] dark:text-[#ff9b91]"
        >
          {exportError}
        </p>
      )}
      <div className="p-5">
        <h3 className="text-sm font-medium text-[#b42318] dark:text-[#ff9b91]">
          {t("Xóa tài khoản", "Delete account")}
        </h3>
        {scheduled ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-loft-secondary)]">
              {t(
                `Tài khoản sẽ bị xóa vĩnh viễn vào ${when}. Bạn vẫn dùng được Mingly đến lúc đó và có thể giữ lại tài khoản bất cứ lúc nào.`,
                `Your account will be permanently deleted on ${when}. You can keep using Mingly until then and keep your account at any time.`,
              )}
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void cancel()}
              className={`${primaryButton} mt-4`}
            >
              {pending
                ? t("Đang hủy…", "Cancelling…")
                : t("Giữ tài khoản", "Keep account")}
            </button>
          </>
        ) : confirming ? (
          <div className="mt-3 rounded-[10px] border border-[#b42318]/40 p-4 dark:border-[#ff9b91]/40">
            <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-[var(--text-loft-secondary)]">
              <li>
                {t(
                  "Sau 14 ngày, tài khoản, hồ sơ và mọi phòng bạn làm chủ (kèm tin nhắn, bảng vẽ) bị xóa vĩnh viễn.",
                  "After 14 days, your account, profile and every room you host (with its messages and boards) are permanently deleted.",
                )}
              </li>
              <li>
                {t(
                  "Tin nhắn của bạn trong phòng người khác được giữ, tên hiển thị là “Deleted member”.",
                  "Your messages in other people's rooms stay, shown as “Deleted member”.",
                )}
              </li>
              <li>
                {t(
                  "Hồ sơ xử lý vi phạm được giữ riêng theo Chính sách quyền riêng tư.",
                  "Moderation records are kept separately, as the Privacy Policy describes.",
                )}
              </li>
            </ul>
            <label htmlFor="delete-confirm" className="mt-4 block text-[13px]">
              {t(`Nhập ${word} để xác nhận`, `Type ${word} to confirm`)}
            </label>
            <input
              id="delete-confirm"
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              className={`${inputClass} mt-2 max-w-xs`}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className={secondaryButton}
              >
                {t("Hủy", "Cancel")}
              </button>
              <button
                type="button"
                disabled={
                  pending ||
                  typed.trim().toLocaleUpperCase(vi ? "vi" : "en") !== word
                }
                onClick={() => void schedule()}
                className={dangerButton}
              >
                {pending
                  ? t("Đang lên lịch…", "Scheduling…")
                  : t("Xóa sau 14 ngày", "Delete in 14 days")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-loft-secondary)]">
              {t(
                "Bạn có 14 ngày để đổi ý trước khi dữ liệu bị xóa vĩnh viễn.",
                "You have 14 days to change your mind before data is permanently deleted.",
              )}
            </p>
            <button
              type="button"
              disabled={!account}
              onClick={() => setConfirming(true)}
              className={`${dangerButton} mt-4`}
            >
              {t("Xóa tài khoản…", "Delete account…")}
            </button>
          </>
        )}
        {error && (
          <p
            role="alert"
            className="mt-3 text-[13px] text-[#b42318] dark:text-[#ff9b91]"
          >
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
