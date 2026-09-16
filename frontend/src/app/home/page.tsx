"use client";

import { Plus, Users, X, Sparkles, Trash2, Settings2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ApiIdentity, ApiRoom } from "@/types/api";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { DeleteRoomDialog } from "@/components/room/DeleteRoomDialog";
import { useUIText } from "@/lib/i18n/uiText";
import { RoomSettings } from "@/components/room/RoomSettings";

export default function HomePage() {
  const tr = useUIText();
  const { locale, t } = useTranslation();
  const [, setIdentity] = useState<ApiIdentity | null>(null);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [name, setName] = useState("");
  const [allowGuests, setAllowGuests] = useState(true);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState<ApiRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsRoom, setSettingsRoom] = useState<ApiRoom | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) {
        location.replace("/");
        return;
      }
      setAccessToken(session.access_token);
      try {
        const [me, list] = await Promise.all([
          api.me(session.access_token),
          api.rooms(session.access_token),
        ]);
        setIdentity(me);
        setRooms(list.rooms);
        const query = new URLSearchParams(location.search);
        setCreating(query.get("create") === "1");
        const settingsSlug = query.get("settings");
        if (settingsSlug) setSettingsRoom(list.rooms.find((item) => item.slug === settingsSlug) ?? null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not load home",
        );
      }
    })();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const session = (await getSupabase()?.auth.getSession())?.data.session;
    if (!session) return;
    try {
      setError(null);
      const room = await api.createRoom(
        session.access_token,
        name,
        allowGuests,
        passwordEnabled,
        password,
      );
      location.assign(`/room/${room.slug}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create room",
      );
    }
  };

  const remove = async () => {
    if (!deletingRoom || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) {
        setError(locale === "vi" ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : "Your session expired. Please sign in again.");
        return;
      }
      await api.deleteRoom(session.access_token, deletingRoom.id);
      setRooms((current) => current.filter((room) => room.id !== deletingRoom.id));
      setDeletingRoom(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : locale === "vi" ? "Không thể xóa phòng" : "Could not delete room");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="page-scroll min-h-screen bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)]">
      <LobbyHeader />
      <div aria-hidden="true" className="h-14" />
      <section className="max-w-5xl mx-auto px-5 py-12">
        <h1 className="text-3xl font-medium leading-tight tracking-tight">
          {locale === "vi" ? "Phòng của bạn" : "Your rooms"}
        </h1>
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-[11px] font-medium">
            {locale === "vi" ? "Phòng bạn làm chủ" : "Rooms you host"}
          </h2>
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-[6px] bg-[#101113] hover:bg-[#101113] text-white text-[11px] font-medium flex items-center gap-2 shadow-lg shadow-[#101113]/20 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.lobby.createRoom}</span>
          </button>
        </div>
        {error && <p className="mt-4 text-[11px] text-[var(--text-loft-primary)]">{tr(error)}</p>}
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <div key={room.id} className="glass-card rounded-[6px] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-[6px] bg-[#101113]/15 text-[var(--text-loft-primary)] flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setSettingsRoom(room)} aria-label={`${locale === "vi" ? "Cài đặt" : "Settings"} ${room.name}`} title={locale === "vi" ? "Cài đặt" : "Settings"} className="w-9 h-9 rounded-[6px] flex items-center justify-center text-[var(--text-loft-muted)] hover:bg-[#101113]/10 hover:text-[var(--text-loft-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]"><Settings2 className="w-4 h-4" /></button>
                  <button type="button" onClick={() => { setError(null); setDeletingRoom(room); }} aria-label={`${locale === "vi" ? "Xóa phòng" : "Delete room"} ${room.name}`} title={locale === "vi" ? "Xóa phòng" : "Delete room"} className="w-9 h-9 rounded-[6px] flex items-center justify-center text-[var(--text-loft-muted)] hover:bg-[#101113]/10 hover:text-[var(--text-loft-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <a href={`/room/${room.slug}`} className="block mt-3 rounded-[6px] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
                <h3 className="font-medium">{room.name}</h3>
                <p className="text-[11px] text-[var(--text-loft-muted)] mt-1">
                  {room.allow_guests ? t.lobby.guestAccessEnabled : t.lobby.signInRequired}
                  {room.password_required && <span className="ml-2">· {locale === "vi" ? "Có mật khẩu" : "Password protected"}</span>}
                  {room.is_locked && <span className="ml-2 text-[var(--text-loft-secondary)]">· {locale === "vi" ? "Đã khóa" : "Locked"}</span>}
                </p>
              </a>
            </div>
          ))}
          {rooms.length === 0 && !creating && (
            <div className="sm:col-span-2 lg:col-span-3 py-12 text-center text-[var(--text-loft-muted)]">
              {locale === "vi" ? "Chưa có phòng." : "No rooms yet."}
            </div>
          )}
        </div>

        <DeleteRoomDialog room={deletingRoom} locale={locale} pending={deleting} error={error} onCancel={() => { setDeletingRoom(null); setError(null); }} onConfirm={() => void remove()} />
        {settingsRoom && accessToken && <RoomSettings room={settingsRoom} token={accessToken} locale={locale} onCancel={() => setSettingsRoom(null)} onSaved={(updated) => { setRooms(current => current.map(item => item.id === updated.id ? updated : item)); setSettingsRoom(null); }} />}

        {/* Modal: Create a Room with beautiful Shadcn Switch */}
        {creating && (
          <div className="fixed inset-0 bg-[#101113]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
              className="fixed inset-0"
              onClick={() => setCreating(false)}
            />
            <form
              onSubmit={create}
              className="create-room-modal relative rounded-[6px] p-6 w-full max-w-md bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-2xl z-10 flex flex-col gap-5 text-[var(--text-loft-primary)]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[6px] bg-[var(--border-loft-light)] text-[var(--text-loft-primary)] flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h2 className="create-room-modal__text text-[11px] font-medium tracking-tight">
                    {t.createModal.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="create-room-modal__text w-8 h-8 rounded-full flex items-center justify-center hover-invert hover:bg-[var(--border-loft)] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Room Name Input */}
              <div className="flex flex-col gap-2">
                <label className="create-room-modal__text text-[11px] font-medium">
                  {t.createModal.nameLabel}{" "}
                  <span className="create-room-modal__muted font-medium">· {t.createModal.nameRequired}</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.createModal.namePlaceholder}
                  required
                  autoFocus
                  className="w-full h-11 px-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] transition-all"
                />
              </div>

              {/* Allow Guests Shadcn Switch */}
              <div className="flex items-center justify-between p-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)]">
                <div className="flex flex-col">
                  <span className="create-room-modal__text text-[11px] font-medium">
                    {t.createModal.allowGuests}
                  </span>
                  <span className="create-room-modal__muted text-[11px] mt-1">
                    {t.createModal.allowGuestsDesc}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowGuests}
                  onClick={() => setAllowGuests(!allowGuests)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-[var(--border-loft)] transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] focus:ring-offset-2 focus:ring-offset-[var(--bg-loft-card)] ${
                    allowGuests ? "bg-[var(--accent-blue)]" : "bg-[var(--bg-loft-surface)]"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--bg-loft-base)] shadow-md ring-0 transition duration-200 ease-in-out ${
                      allowGuests ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <label className="create-room-modal__text flex items-center justify-between p-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] text-[11px]">
                <span>{locale === "vi" ? "Yêu cầu mật khẩu" : "Require password"}</span>
                <input className="accent-[var(--accent-blue)]" type="checkbox" checked={passwordEnabled} onChange={(e) => setPasswordEnabled(e.target.checked)} />
              </label>
              {passwordEnabled && <input type="password" minLength={4} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={locale === "vi" ? "Mật khẩu (ít nhất 4 ký tự)" : "Password (at least 4 characters)"} required className="w-full h-11 px-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]" />}

              {/* Actions */}
              <div className="mt-2 flex gap-3 justify-end items-center">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="create-room-modal__secondary-action h-10 px-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] hover-invert hover:bg-[var(--border-loft)] text-[11px] font-medium transition-colors cursor-pointer"
                >
                  {t.createModal.cancel}
                </button>
                <button
                  type="submit"
                  className="create-room-modal__primary-action h-10 px-5 rounded-[6px] bg-[var(--accent-blue)] text-[11px] font-medium active:scale-95 transition-all cursor-pointer"
                >
                  {t.createModal.createRoom}
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
