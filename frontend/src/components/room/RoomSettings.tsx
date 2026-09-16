"use client";

import { FormEvent, useState } from "react";
import type { ApiRoom, RoomAccent, RoomAtmosphere } from "@/types/api";
import { api } from "@/lib/api";
import { useSfxStore } from "@/stores/useSfxStore";

export function RoomSettings({
  room,
  token,
  locale,
  onCancel,
  onSaved,
  isHost = true,
  onAppearanceUpdate,
}: {
  room: ApiRoom;
  token: string;
  locale: "vi" | "en";
  onCancel: () => void;
  onSaved: (room: ApiRoom) => void;
  isHost?: boolean;
  onAppearanceUpdate?: (update: {
    atmosphere: RoomAtmosphere;
    accent: RoomAccent;
    adaptive_media_background: boolean;
    expected_version: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(room.name);
  const [allowGuests, setAllowGuests] = useState(room.allow_guests);
  const [passwordEnabled, setPasswordEnabled] = useState(room.password_required);
  const [password, setPassword] = useState("");
  const [locked, setLocked] = useState(room.is_locked);
  const [atmosphere, setAtmosphere] = useState<RoomAtmosphere>(room.atmosphere ?? "ambient");
  const [accent, setAccent] = useState<RoomAccent>(room.accent ?? "blue");
  const [adaptiveMedia, setAdaptiveMedia] = useState(room.adaptive_media_background ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundEffectsEnabled = useSfxStore((state) => state.soundEffectsEnabled);
  const roomSoundsEnabled = useSfxStore((state) => state.roomSoundsEnabled);
  const sfxVolume = useSfxStore((state) => state.volume);
  const setSoundEffectsEnabled = useSfxStore((state) => state.setSoundEffectsEnabled);
  const setRoomSoundsEnabled = useSfxStore((state) => state.setRoomSoundsEnabled);
  const setSfxVolume = useSfxStore((state) => state.setVolume);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (
        isHost &&
        onAppearanceUpdate &&
        (atmosphere !== room.atmosphere ||
          accent !== room.accent ||
          adaptiveMedia !== room.adaptive_media_background)
      ) {
        await onAppearanceUpdate({
          atmosphere,
          accent,
          adaptive_media_background: adaptiveMedia,
          expected_version: room.version,
        });
      }
      const updated = await api.updateRoom(token, room.id, {
        expected_version: room.version,
        name,
        allow_guests: allowGuests,
        password_enabled: passwordEnabled,
        password: passwordEnabled ? password : "",
        locked,
      });
      onSaved(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : locale === "vi"
            ? "Không thể lưu cài đặt"
            : "Could not save settings",
      );
    } finally {
      setPending(false);
    }
  };

  const vi = locale === "vi";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-settings-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 shadow-2xl"
      >
        <h2 id="room-settings-title" className="text-lg font-semibold">{vi ? "Cài đặt phòng" : "Room settings"}</h2>
        <label className="mt-4 block text-sm">
          {vi ? "Tên phòng" : "Room name"}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={80}
            required
            disabled={pending}
            className="mt-1 w-full rounded-xl border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 py-2"
          />
        </label>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowGuests}
            disabled={pending}
            onChange={(e) => setAllowGuests(e.target.checked)}
          />
          {vi ? "Cho phép khách vào" : "Allow guests"}
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={passwordEnabled}
            disabled={pending}
            onChange={(e) => setPasswordEnabled(e.target.checked)}
          />
          {vi ? "Yêu cầu mật khẩu" : "Require password"}
        </label>
        {passwordEnabled && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={4}
            maxLength={256}
            disabled={pending}
            placeholder={vi ? "Mật khẩu mới (để trống nếu không đổi)" : "New password"}
            aria-label={vi ? "Mật khẩu mới" : "New password"}
            className="mt-2 w-full rounded-xl border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 py-2"
          />
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={locked}
            disabled={pending}
            onChange={(e) => setLocked(e.target.checked)}
          />
          {vi ? "Khóa phòng với người mới" : "Lock room for new arrivals"}
        </label>

        {isHost && (
          <fieldset className="mt-5 border-t border-[var(--border-loft)] pt-4" aria-label={vi ? "Không khí phòng" : "Room atmosphere"}>
            <legend className="text-sm font-semibold">{vi ? "Không khí phòng" : "Room atmosphere"}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={vi ? "Không khí phòng" : "Room atmosphere"}>
              {(["minimal", "ambient", "focus", "party"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={atmosphere === option}
                  disabled={pending}
                  onClick={() => setAtmosphere(option)}
                  className={`rounded-xl border px-3 py-2 text-sm capitalize transition-colors ${
                    atmosphere === option
                      ? "border-[#0066CC] bg-[#0066CC]/10 font-medium text-[#0066CC]"
                      : "border-[var(--border-loft)] bg-[var(--bg-loft-surface)] hover:bg-[var(--border-loft-light)]"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="mt-4 text-xs font-medium text-[var(--text-loft-secondary)]">{vi ? "Màu chủ đạo" : "Accent color"}</div>
            <div className="mt-2 flex gap-2" role="radiogroup" aria-label={vi ? "Màu chủ đạo" : "Accent color"}>
              {(["blue", "purple", "green", "orange", "rose"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={accent === option}
                  disabled={pending}
                  onClick={() => setAccent(option)}
                  aria-label={option}
                  data-accent={option}
                  className={`h-7 w-7 rounded-full border-2 transition-transform ${
                    accent === option ? "scale-110 border-[var(--text-loft-primary)] ring-2 ring-[#0066CC]" : "border-transparent"
                  }`}
                />
              ))}
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={adaptiveMedia}
                disabled={pending}
                onChange={(e) => setAdaptiveMedia(e.target.checked)}
              />
              {vi ? "Tự điều chỉnh theo media đang phát" : "Adapt to shared media"}
            </label>
          </fieldset>
        )}

        <fieldset className="mt-5 border-t border-[var(--border-loft)] pt-4">
          <legend className="text-sm font-semibold">{vi ? "Âm thanh" : "Sounds"}</legend>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={soundEffectsEnabled}
              disabled={pending}
              onChange={(e) => setSoundEffectsEnabled(e.target.checked)}
            />
            {vi ? "Hiệu ứng âm thanh" : "Sound effects"}
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={roomSoundsEnabled}
              disabled={pending}
              onChange={(e) => setRoomSoundsEnabled(e.target.checked)}
            />
            {vi ? "Âm thanh trong phòng" : "Room sounds"}
          </label>
          <label className="mt-3 block text-sm">
            {vi ? "Âm lượng hiệu ứng" : "Effects volume"}: {sfxVolume}%
            <input
              className="mt-2 w-full"
              type="range"
              min={0}
              max={100}
              value={sfxVolume}
              disabled={pending}
              onChange={(e) => setSfxVolume(Number(e.target.value))}
            />
          </label>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-[#FF3B30]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-xl border border-[var(--border-loft)] px-4 py-2 text-sm"
          >
            {vi ? "Hủy" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-[#0066CC] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? (vi ? "Đang lưu…" : "Saving…") : (vi ? "Lưu" : "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
