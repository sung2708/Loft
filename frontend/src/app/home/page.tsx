"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CircleAlert,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Settings2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ApiIdentity, ApiRoom } from "@/types/api";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { DeleteRoomDialog } from "@/components/room/DeleteRoomDialog";
import { useUIText } from "@/lib/i18n/uiText";
import { RoomSettings } from "@/components/room/RoomSettings";

type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

function Switch({ checked, disabled, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] focus:ring-offset-2 focus:ring-offset-[var(--bg-loft-card)] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-[#101113] bg-[#101113] dark:border-[#f4f5f7] dark:bg-[#f4f5f7]"
          : "border-[#101113] bg-[#d1d5db] dark:border-[#f4f5f7] dark:bg-[#4a4d52]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 rounded-full shadow-md transition-transform duration-200 ease-in-out ${
          checked
            ? "translate-x-5 bg-white dark:bg-[#101113]"
            : "translate-x-0 bg-[#101113] dark:bg-[#f4f5f7]"
        }`}
      />
    </button>
  );
}

function roomActionError(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) {
    const messages: Record<string, string> = {
      INVALID_ROOM_NAME: "Room name must be 2–80 characters",
      RATE_LIMITED: "Too many room creation attempts",
      ROOM_BUSY: "Room is active or being deleted",
      ROOM_NOT_FOUND: "Room not found",
      UNAUTHORIZED: "Authentication required",
    };
    return messages[caught.code] ?? fallback;
  }
  return fallback;
}

export default function HomePage() {
  const tr = useUIText();
  const { locale, t } = useTranslation();
  const isVietnamese = locale === "vi";
  const [, setIdentity] = useState<ApiIdentity | null>(null);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [name, setName] = useState("");
  const [allowGuests, setAllowGuests] = useState(true);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [deletingRoom, setDeletingRoom] = useState<ApiRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsRoom, setSettingsRoom] = useState<ApiRoom | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createDialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) {
        const target = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/?next=${encodeURIComponent(target)}`);
        return;
      }

      if (active) setAccessToken(session.access_token);
      try {
        const [me, list] = await Promise.all([
          api.me(session.access_token),
          api.rooms(session.access_token),
        ]);
        if (!active) return;

        setIdentity(me);
        setRooms(list.rooms);
        const query = new URLSearchParams(window.location.search);
        setCreating(query.get("create") === "1");
        const settingsSlug = query.get("settings");
        if (settingsSlug) {
          setSettingsRoom(
            list.rooms.find((item) => item.slug === settingsSlug) ?? null,
          );
        }
      } catch (caught) {
        if (active) {
          setError(roomActionError(caught, "Could not load home"));
        }
      } finally {
        if (active) setIsLoadingRooms(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!creating) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        setCreating(false);
        setError(null);
        window.requestAnimationFrame(() => createButtonRef.current?.focus());
        return;
      }

      if (event.key === "Tab" && createDialogRef.current) {
        const focusable = Array.from(
          createDialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled])',
          ),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [creating, isSubmitting]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const session = (await getSupabase()?.auth.getSession())?.data.session;
    if (!session) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const room = await api.createRoom(
        session.access_token,
        name,
        allowGuests,
        passwordEnabled,
        password,
      );
      window.location.assign(`/room/${encodeURIComponent(room.slug)}`);
    } catch (caught) {
      setError(roomActionError(caught, "Could not create room"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async () => {
    if (!deletingRoom || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) {
        setError(
          isVietnamese
            ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
            : "Your session expired. Please sign in again.",
        );
        return;
      }
      await api.deleteRoom(session.access_token, deletingRoom.id);
      setRooms((current) =>
        current.filter((room) => room.id !== deletingRoom.id),
      );
      setDeletingRoom(null);
    } catch (caught) {
      setError(roomActionError(caught, "Request failed"));
    } finally {
      setDeleting(false);
    }
  };

  const openCreateDialog = () => {
    setError(null);
    setCreating(true);
  };

  const closeCreateDialog = () => {
    if (isSubmitting) return;
    setCreating(false);
    setError(null);
    window.requestAnimationFrame(() => createButtonRef.current?.focus());
  };

  return (
    <main className="app-canvas page-scroll min-h-dvh text-[var(--text-loft-primary)]">
      <LobbyHeader />
      <div aria-hidden="true" className="h-14" />

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">{isVietnamese ? "Phòng" : "Spaces"}</p>
            <h1 className="mt-2 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.05em]">
              {isVietnamese ? "Phòng của bạn" : "Your rooms"}
            </h1>
          </div>
          <button
            type="button"
            ref={createButtonRef}
            onClick={openCreateDialog}
            className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-[6px] bg-[#101113] px-4 text-[11px] font-medium text-white"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            <span>{t.lobby.createRoom}</span>
          </button>
        </div>

        {error && !creating && !deletingRoom ? (
          <div
            role="alert"
            className="mt-8 flex items-start gap-3 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 py-3 text-[11px]"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{tr(error)}</p>
          </div>
        ) : null}

        <section aria-labelledby="hosted-rooms-heading" className="mt-10">
          <div className="flex items-center justify-between border-b border-[var(--border-loft)] pb-3">
            <h2 id="hosted-rooms-heading" className="text-[11px] font-medium">
              {isVietnamese ? "Phòng bạn làm chủ" : "Rooms you host"}
            </h2>
            {!isLoadingRooms ? (
              <span className="text-[11px] text-[var(--text-loft-muted)]">
                {rooms.length}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {isLoadingRooms
              ? Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    aria-hidden="true"
                    className="workflow-panel min-h-48 rounded-[6px] p-5 motion-safe:animate-pulse"
                  >
                    <div className="h-10 w-10 rounded-[6px] bg-[#101113]/10" />
                    <div className="mt-6 h-4 w-2/3 rounded bg-[#101113]/10" />
                    <div className="mt-3 h-3 w-full rounded bg-[#101113]/10" />
                  </div>
                ))
              : rooms.map((room) => (
                  <article
                    key={room.id}
                    className="workflow-panel interactive-card group flex min-h-48 flex-col rounded-[6px] p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[#101113]/10 text-[var(--text-loft-primary)]">
                        <Users aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSettingsRoom(room)}
                          aria-label={`${isVietnamese ? "Cài đặt" : "Settings"} ${room.name}`}
                          title={isVietnamese ? "Cài đặt" : "Settings"}
                          className="btn-press hover-invert flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-loft-muted)]"
                        >
                          <Settings2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setDeletingRoom(room);
                          }}
                          aria-label={`${isVietnamese ? "Xóa phòng" : "Delete room"} ${room.name}`}
                          title={isVietnamese ? "Xóa phòng" : "Delete room"}
                          className="btn-press hover-invert flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-loft-muted)]"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <Link
                      href={`/room/${encodeURIComponent(room.slug)}`}
                      aria-label={`${isVietnamese ? "Mở phòng" : "Open room"} ${room.name}`}
                      className="mt-5 flex min-h-0 flex-1 flex-col rounded-[6px] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]"
                    >
                      <h3 className="break-words text-base font-medium tracking-tight">
                        {room.name}
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-loft-muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          <Users aria-hidden="true" className="h-3.5 w-3.5" />
                          {room.allow_guests
                            ? isVietnamese
                              ? "Khách có thể vào"
                              : "Guests can join"
                            : isVietnamese
                              ? "Cần đăng nhập"
                              : "Sign-in required"}
                        </span>
                        {room.password_required ? (
                          <span className="inline-flex items-center gap-1.5">
                            <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
                            {isVietnamese ? "Có mật khẩu" : "Password"}
                          </span>
                        ) : null}
                        {room.is_locked ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Lock aria-hidden="true" className="h-3.5 w-3.5" />
                            {isVietnamese ? "Đã khóa" : "Locked"}
                          </span>
                        ) : null}
                      </div>
                      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[11px] font-medium text-[var(--text-loft-primary)]">
                        {isVietnamese ? "Mở" : "Open"}
                        <ArrowUpRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 transition-transform duration-200 ease-in-out motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                        />
                      </span>
                    </Link>
                  </article>
                ))}

            {!isLoadingRooms && rooms.length === 0 && !creating ? (
              <div className="workflow-panel rounded-[6px] px-6 py-14 text-center sm:col-span-2 lg:col-span-3">
                <Users aria-hidden="true" className="mx-auto h-5 w-5" />
                <p className="mt-4 text-[11px] font-medium">
                  {isVietnamese ? "Bạn chưa có phòng." : "You have no rooms yet."}
                </p>
                <p className="mt-1 text-[11px] text-[var(--text-loft-muted)]">
                  {isVietnamese
                    ? "Tạo phòng để chia sẻ liên kết mời."
                    : "Create a room to share an invite link."}
                </p>
                <button
                  type="button"
                  onClick={openCreateDialog}
                  className="btn-press hover-invert mt-5 inline-flex h-9 items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[11px] font-medium text-[var(--text-loft-primary)]"
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  {t.lobby.createRoom}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </section>

      <DeleteRoomDialog
        room={deletingRoom}
        locale={locale}
        pending={deleting}
        error={error}
        onCancel={() => {
          setDeletingRoom(null);
          setError(null);
        }}
        onConfirm={() => void remove()}
      />
      {settingsRoom && accessToken ? (
        <RoomSettings
          room={settingsRoom}
          token={accessToken}
          locale={locale}
          onCancel={() => setSettingsRoom(null)}
          onSaved={(updated) => {
            setRooms((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setSettingsRoom(null);
          }}
        />
      ) : null}

      {creating ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#101113]/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreateDialog();
          }}
        >
          <form
            ref={createDialogRef}
            onSubmit={create}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-room-title"
            aria-busy={isSubmitting}
            className="create-room-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-5 overflow-y-auto rounded-[6px] border border-[var(--border-loft)] p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#101113]/10">
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </div>
                <h2 id="create-room-title" className="create-room-modal__text text-[11px] font-medium">
                  {t.createModal.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={isSubmitting}
                aria-label={isVietnamese ? "Đóng" : "Close"}
                className="btn-press hover-invert flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-loft-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="room-name" className="create-room-modal__text text-[11px] font-medium">
                {t.createModal.nameLabel}
                <span className="create-room-modal__muted"> · {t.createModal.nameRequired}</span>
              </label>
              <input
                id="room-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.createModal.namePlaceholder}
                minLength={2}
                maxLength={80}
                required
                disabled={isSubmitting}
                autoFocus
                className="h-11 w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[11px] text-[var(--text-loft-primary)] outline-none placeholder:text-[var(--text-loft-muted)] focus:ring-2 focus:ring-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="space-y-3 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="create-room-modal__text text-[11px] font-medium">
                    {t.createModal.allowGuests}
                  </p>
                  <p className="create-room-modal__muted mt-1 text-[11px]">
                    {t.createModal.allowGuestsDesc}
                  </p>
                </div>
                <Switch
                  checked={allowGuests}
                  disabled={isSubmitting}
                  label={t.createModal.allowGuests}
                  onChange={setAllowGuests}
                />
              </div>
              <div className="border-t border-[var(--border-loft)] pt-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="create-room-modal__text text-[11px] font-medium">
                      {isVietnamese ? "Yêu cầu mật khẩu" : "Require password"}
                    </p>
                    <p className="create-room-modal__muted mt-1 text-[11px]">
                      {isVietnamese
                        ? "Người tham gia cần mật khẩu để vào."
                        : "People need a password to join."}
                    </p>
                  </div>
                  <Switch
                    checked={passwordEnabled}
                    disabled={isSubmitting}
                    label={isVietnamese ? "Yêu cầu mật khẩu" : "Require password"}
                    onChange={setPasswordEnabled}
                  />
                </div>
                {passwordEnabled ? (
                  <div className="mt-3">
                    <label htmlFor="room-password" className="sr-only">
                      {isVietnamese ? "Mật khẩu phòng" : "Room password"}
                    </label>
                    <input
                      id="room-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={isVietnamese ? "Mật khẩu (ít nhất 4 ký tự)" : "Password (at least 4 characters)"}
                      minLength={4}
                      maxLength={256}
                      required
                      disabled={isSubmitting}
                      className="h-11 w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-4 text-[11px] text-[var(--text-loft-primary)] outline-none placeholder:text-[var(--text-loft-muted)] focus:ring-2 focus:ring-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {error ? (
              <div role="alert" className="flex items-start gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[11px]">
                <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{tr(error)}</p>
              </div>
            ) : null}

            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={isSubmitting}
                className="btn-press hover-invert h-10 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[11px] font-medium text-[var(--text-loft-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.createModal.cancel}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-[6px] bg-[#101113] px-5 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> : null}
                {isSubmitting
                  ? isVietnamese
                    ? "Đang tạo…"
                    : "Creating…"
                  : t.createModal.createRoom}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
