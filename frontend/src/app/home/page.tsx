"use client";

import { Plus, LogOut, Users, X, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ApiIdentity, ApiRoom } from "@/types/api";
import { LoftMark } from "@/components/brand/LoftMark";
import { DeleteRoomDialog } from "@/components/room/DeleteRoomDialog";
import { useUIText } from "@/lib/i18n/uiText";

export default function HomePage() {
  const tr = useUIText();
  const { locale, t, toggleLocale } = useTranslation();
  const [identity, setIdentity] = useState<ApiIdentity | null>(null);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [name, setName] = useState("");
  const [allowGuests, setAllowGuests] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState<ApiRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) {
        location.replace("/");
        return;
      }
      try {
        const [me, list] = await Promise.all([
          api.me(session.access_token),
          api.rooms(session.access_token),
        ]);
        setIdentity(me);
        setRooms(list.rooms);
        setCreating(new URLSearchParams(location.search).get("create") === "1");
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
      );
      location.assign(`/room/${room.id}`);
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
      <nav className="h-16 max-w-5xl mx-auto px-5 flex items-center justify-between border-b border-[var(--border-loft)]">
        <a href="/" className="text-lg flex items-center gap-2">
          <LoftMark className="w-8 h-8 shrink-0 text-[var(--brand-mark)]" />
          <span className="loft-wordmark">Loft</span>
        </a>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleLocale}
            title={locale === "vi" ? "Chuyển sang tiếng Anh" : "Switch to Vietnamese"}
            className="btn-press h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-semibold text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] cursor-pointer transition-colors"
          >
            <span className={locale === "vi" ? "text-[#0066CC]" : ""}>VI</span>
            <span className="text-[var(--text-loft-muted)] opacity-50">/</span>
            <span className={locale === "en" ? "text-[#0066CC]" : ""}>EN</span>
          </button>
          <button
            onClick={async () => {
              await getSupabase()?.auth.signOut();
              location.assign("/");
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--text-loft-secondary)] hover:text-[#FF3B30] transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.common.signOut}</span>
          </button>
        </div>
      </nav>
      <section className="max-w-5xl mx-auto px-5 py-12">
        <p className="text-sm text-[#0066CC] font-medium">
          {locale === "vi" ? "Chào mừng bạn" : "Welcome back"}
        </p>
        <h1 className="text-4xl font-bold mt-1">
          {identity?.display_name ?? (locale === "vi" ? "Phòng của bạn" : "Your rooms")}
        </h1>
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {locale === "vi" ? "Phòng bạn làm chủ" : "Rooms you host"}
          </h2>
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-xl bg-[#0066CC] hover:bg-[#0052A3] text-white text-sm font-semibold flex items-center gap-2 shadow-lg shadow-[#0066CC]/20 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.lobby.createRoom}</span>
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-[#FF3B30]">{tr(error)}</p>}
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <div key={room.id} className="glass-card rounded-2xl p-5 hover:border-[#0066CC]/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0066CC]/15 text-[#0066CC] flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <button type="button" onClick={() => { setError(null); setDeletingRoom(room); }} aria-label={`${locale === "vi" ? "Xóa phòng" : "Delete room"} ${room.name}`} title={locale === "vi" ? "Xóa phòng" : "Delete room"} className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-loft-muted)] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 focus-visible:outline-2 focus-visible:outline-[#FF3B30]">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <a href={`/room/${room.id}`} className="block mt-4 rounded-lg focus-visible:outline-2 focus-visible:outline-[#0066CC]">
                <h3 className="font-semibold">{room.name}</h3>
                <p className="text-xs text-[var(--text-loft-muted)] mt-1">
                  {room.allow_guests ? t.lobby.guestAccessEnabled : t.lobby.signInRequired}
                </p>
              </a>
            </div>
          ))}
          {rooms.length === 0 && !creating && (
            <div className="sm:col-span-2 lg:col-span-3 py-16 text-center text-[var(--text-loft-muted)]">
              {locale === "vi"
                ? "Chưa có phòng nào. Hãy tạo góc riêng đầu tiên của bạn."
                : "No rooms yet. Make your first cozy corner."}
            </div>
          )}
        </div>

        <DeleteRoomDialog room={deletingRoom} locale={locale} pending={deleting} error={error} onCancel={() => { setDeletingRoom(null); setError(null); }} onConfirm={() => void remove()} />

        {/* Modal: Create a Room with beautiful Shadcn Switch */}
        {creating && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
              className="fixed inset-0"
              onClick={() => setCreating(false)}
            />
            <form
              onSubmit={create}
              className="relative rounded-3xl p-6 w-full max-w-md bg-[#1C1C1E] border border-white/10 shadow-2xl z-10 flex flex-col gap-5 text-white"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#0066CC]/20 text-[#0066CC] flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {t.createModal.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Room Name Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  {t.createModal.nameLabel}{" "}
                  <span className="text-zinc-500 font-normal">· {t.createModal.nameRequired}</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.createModal.namePlaceholder}
                  required
                  autoFocus
                  className="w-full h-11 px-3.5 rounded-xl bg-zinc-900 border border-zinc-700/80 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#0066CC] focus:ring-2 focus:ring-[#0066CC]/30 transition-all"
                />
              </div>

              {/* Allow Guests Shadcn Switch */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-900/70 border border-zinc-800">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-white">
                    {t.createModal.allowGuests}
                  </span>
                  <span className="text-xs text-zinc-400 mt-0.5">
                    {t.createModal.allowGuestsDesc}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowGuests}
                  onClick={() => setAllowGuests(!allowGuests)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0066CC] focus:ring-offset-2 focus:ring-offset-zinc-900 ${
                    allowGuests ? "bg-[#0066CC]" : "bg-zinc-700"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      allowGuests ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Actions */}
              <div className="mt-2 flex gap-2.5 justify-end items-center">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="h-10 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  {t.createModal.cancel}
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 rounded-xl bg-[#0066CC] hover:bg-[#0052A3] text-white text-sm font-semibold shadow-lg shadow-[#0066CC]/25 active:scale-95 transition-all cursor-pointer"
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
