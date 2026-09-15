"use client";

import { FormEvent, useState } from "react";
import type { ApiRoom } from "@/types/api";
import { api } from "@/lib/api";
import { useSfxStore } from "@/stores/useSfxStore";

export function RoomSettings({ room, token, locale, onCancel, onSaved }: { room: ApiRoom; token: string; locale: "vi" | "en"; onCancel: () => void; onSaved: (room: ApiRoom) => void }) {
  const [name, setName] = useState(room.name);
  const [allowGuests, setAllowGuests] = useState(room.allow_guests);
  const [passwordEnabled, setPasswordEnabled] = useState(room.password_required);
  const [password, setPassword] = useState("");
  const [locked, setLocked] = useState(room.is_locked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundEffectsEnabled = useSfxStore((state) => state.soundEffectsEnabled);
  const roomSoundsEnabled = useSfxStore((state) => state.roomSoundsEnabled);
  const sfxVolume = useSfxStore((state) => state.volume);
  const setSoundEffectsEnabled = useSfxStore((state) => state.setSoundEffectsEnabled);
  const setRoomSoundsEnabled = useSfxStore((state) => state.setRoomSoundsEnabled);
  const setSfxVolume = useSfxStore((state) => state.setVolume);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const updated = await api.updateRoom(token, room.id, { expected_version: room.version, name, allow_guests: allowGuests, password_enabled: passwordEnabled, password: passwordEnabled ? password : "", locked });
      onSaved(updated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : (locale === "vi" ? "Không thể lưu cài đặt" : "Could not save settings")); }
    finally { setPending(false); }
  };
  const vi = locale === "vi";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
    <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="room-settings-title" className="w-full max-w-md rounded-2xl border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 shadow-2xl">
      <h2 id="room-settings-title" className="text-lg font-semibold">{vi ? "Cài đặt phòng" : "Room settings"}</h2>
      <label className="mt-4 block text-sm">{vi ? "Tên phòng" : "Room name"}<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required className="mt-1 w-full rounded-xl border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 py-2" /></label>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={allowGuests} onChange={e => setAllowGuests(e.target.checked)} />{vi ? "Cho phép khách vào" : "Allow guests"}</label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={passwordEnabled} onChange={e => setPasswordEnabled(e.target.checked)} />{vi ? "Yêu cầu mật khẩu" : "Require password"}</label>
      {passwordEnabled && <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={4} maxLength={256} placeholder={vi ? "Mật khẩu mới (để trống nếu không đổi)" : "New password"} aria-label={vi ? "Mật khẩu mới" : "New password"} className="mt-2 w-full rounded-xl border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 py-2" />}
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} />{vi ? "Khóa phòng với người mới" : "Lock room for new arrivals"}</label>
      <fieldset className="mt-5 border-t border-[var(--border-loft)] pt-4">
        <legend className="text-sm font-semibold">{vi ? "Âm thanh" : "Sounds"}</legend>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={soundEffectsEnabled} onChange={e => setSoundEffectsEnabled(e.target.checked)} />{vi ? "Hiệu ứng âm thanh" : "Sound effects"}</label>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={roomSoundsEnabled} onChange={e => setRoomSoundsEnabled(e.target.checked)} />{vi ? "Âm thanh trong phòng" : "Room sounds"}</label>
        <label className="mt-3 block text-sm">{vi ? "Âm lượng hiệu ứng" : "Effects volume"}: {sfxVolume}%
          <input className="mt-2 w-full" type="range" min={0} max={100} value={sfxVolume} onChange={e => setSfxVolume(Number(e.target.value))} />
        </label>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-[#FF3B30]">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={pending} className="rounded-xl border border-[var(--border-loft)] px-4 py-2 text-sm">{vi ? "Hủy" : "Cancel"}</button><button type="submit" disabled={pending} className="rounded-xl bg-[#0066CC] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? (vi ? "Đang lưu…" : "Saving…") : (vi ? "Lưu" : "Save")}</button></div>
    </form>
  </div>;
}
