"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  X,
  Lock,
  Shield,
  Sparkles,
  Volume2,
  Check,
  Loader2,
  Sliders,
  Eye,
  EyeOff,
  Feather,
  Waves,
  Focus,
  Flame,
  Music,
} from "lucide-react";
import type { ApiRoom, RoomAccent, RoomAtmosphere } from "@/types/api";
import { api } from "@/lib/api";
import { useSfxStore } from "@/stores/useSfxStore";

function Switch({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] focus:ring-offset-2 focus:ring-offset-[var(--bg-loft-card)] disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-[#101113]" : "bg-[#26282c]/40 dark:bg-[#26282c]/60"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, pending]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      let currentVersion = room.version;
      const appearanceChanged =
        isHost &&
        Boolean(onAppearanceUpdate) &&
        (atmosphere !== room.atmosphere ||
          accent !== room.accent ||
          adaptiveMedia !== room.adaptive_media_background);

      const accessChanged =
        name !== room.name ||
        allowGuests !== room.allow_guests ||
        passwordEnabled !== room.password_required ||
        (passwordEnabled && password.length > 0) ||
        locked !== room.is_locked;

      let updated = room;
      if (accessChanged || !appearanceChanged) {
        updated = await api.updateRoom(token, room.id, {
          expected_version: currentVersion,
          name,
          allow_guests: allowGuests,
          password_enabled: passwordEnabled,
          password: passwordEnabled ? password : "",
          locked,
        });
        currentVersion = updated.version;
      }

      if (appearanceChanged && onAppearanceUpdate) {
        await onAppearanceUpdate({
          atmosphere,
          accent,
          adaptive_media_background: adaptiveMedia,
          expected_version: currentVersion,
        });
        updated = {
          ...updated,
          atmosphere,
          accent,
          adaptive_media_background: adaptiveMedia,
          version: currentVersion + 1,
        };
      }
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101113]/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-settings-title"
        className="kott-settings max-h-[90vh] w-full max-w-lg overflow-y-auto border flex flex-col"
      >
        {/* Modal Header */}
        <div className="h-14 px-6 flex items-center justify-between border-b border-[var(--border-loft)] shrink-0 bg-[var(--bg-loft-surface)]/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-[#101113]/15 text-[var(--text-loft-primary)] flex items-center justify-center">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 id="room-settings-title" className="text-[11px] font-medium leading-none text-[var(--text-loft-primary)]">
                {vi ? "Cài đặt phòng" : "Room settings"}
              </h2>
              <p className="text-[11px] text-[var(--text-loft-muted)] mt-1 truncate max-w-[240px]">
                {room.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label={vi ? "Đóng" : "Close"}
            className="w-8 h-8 rounded-full hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] flex items-center justify-center transition-colors text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Room Name Card */}
          <div className="p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-[var(--text-loft-secondary)]">
                {vi ? "Tên phòng" : "Room name"}
              </label>
              <span className="text-[11px] font-mono text-[var(--text-loft-muted)]">
                {name.length}/80
              </span>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={80}
              required
              disabled={pending}
              placeholder={vi ? "Nhập tên phòng..." : "Enter room name..."}
              className="w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-4 py-2 text-[11px] text-[var(--text-loft-primary)] outline-none transition-all focus:border-[var(--border-loft)] focus:ring-2 focus:ring-[var(--accent-blue)]/20 disabled:opacity-50"
            />
          </div>

          {/* Access & Guests */}
          <div className="flex items-center justify-between gap-3 p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60">
            <div className="min-w-0 pr-2">
              <div className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                {vi ? "Cho phép khách vào" : "Allow guests"}
              </div>
              <div className="text-[11px] text-[var(--text-loft-muted)] mt-1">
                {vi
                  ? "Khách vãng lai có thể tham gia mà không cần tài khoản"
                  : "Guests can join without an account"}
              </div>
            </div>
            <Switch
              checked={allowGuests}
              disabled={pending}
              onChange={setAllowGuests}
              aria-label={vi ? "Cho phép khách vào" : "Allow guests"}
            />
          </div>

          {/* Password Protection */}
          <div className="p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 rounded-[6px] bg-[#26282c]/10 flex items-center justify-center text-[var(--text-loft-secondary)]">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                    {vi ? "Yêu cầu mật khẩu" : "Require password"}
                  </div>
                  <div className="text-[11px] text-[var(--text-loft-muted)]">
                    {passwordEnabled
                      ? vi
                        ? "Phòng đang được bảo vệ bởi mật khẩu"
                        : "Room is password protected"
                      : vi
                        ? "Người tham gia không cần mật khẩu"
                        : "Anyone with the link can join directly"}
                  </div>
                </div>
              </div>
              <Switch
                checked={passwordEnabled}
                disabled={pending}
                onChange={setPasswordEnabled}
                aria-label={vi ? "Yêu cầu mật khẩu" : "Require password"}
              />
            </div>

            {passwordEnabled && (
              <div className="relative pt-2 border-t border-[var(--border-loft)]">
                <label className="block text-[11px] font-medium text-[var(--text-loft-secondary)] mb-1">
                  {room.password_required
                    ? vi
                      ? "Mật khẩu mới (để trống nếu không đổi)"
                      : "New password (leave blank to keep)"
                    : vi
                      ? "Mật khẩu phòng"
                      : "Room password"}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={4}
                    maxLength={256}
                    disabled={pending}
                    required={!room.password_required}
                    placeholder={
                      room.password_required
                        ? vi
                          ? "Mật khẩu mới (để trống nếu không đổi)"
                          : "New password"
                        : vi
                          ? "Nhập mật khẩu (tối thiểu 4 ký tự)..."
                          : "Enter password (min 4 chars)..."
                    }
                    aria-label={vi ? "Mật khẩu mới" : "New password"}
                    className="w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 py-2 pr-10 text-[11px] text-[var(--text-loft-primary)] outline-none transition-all focus:border-[var(--border-loft)] focus:ring-2 focus:ring-[var(--accent-blue)]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-3 text-[var(--text-loft-muted)] hover:text-[var(--text-loft-primary)] transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Lock Room */}
          <div className="flex items-center justify-between gap-3 p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60">
            <div className="flex items-center gap-3 min-w-0 pr-2">
              <div className="w-7 h-7 rounded-[6px] bg-[#26282c]/10 text-[var(--text-loft-secondary)] flex items-center justify-center shrink-0">
                <Shield className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[var(--text-loft-primary)] flex items-center gap-2">
                  <span>{vi ? "Khóa phòng với người mới" : "Lock room for new arrivals"}</span>
                  {locked && (
                    <span className="px-2 py-1 rounded-[6px] bg-[#26282c]/15 text-[var(--text-loft-secondary)] dark:text-[var(--text-loft-secondary)] text-[11px] font-medium">
                      {vi ? "Đã khóa" : "Locked"}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-loft-muted)] mt-1">
                  {vi
                    ? "Chỉ những người đang trong phòng mới tiếp tục tham gia"
                    : "Block new arrivals while current participants remain"}
                </div>
              </div>
            </div>
            <Switch
              checked={locked}
              disabled={pending}
              onChange={setLocked}
              aria-label={vi ? "Khóa phòng với người mới" : "Lock room for new arrivals"}
            />
          </div>

          {/* Atmosphere & Theme (Host only) */}
          {isHost && (
            <fieldset
              className="p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 space-y-4"
              aria-label={vi ? "Không khí phòng" : "Room atmosphere"}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--text-loft-primary)]" />
                <legend className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
                  {vi ? "Không khí phòng" : "Room atmosphere"}
                </legend>
              </div>

              {/* 4 Atmosphere Modes in 2x2 grid */}
              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label={vi ? "Không khí phòng" : "Room atmosphere"}
              >
                {(
                  [
                    {
                      id: "minimal",
                      icon: Feather,
                      descVi: "Giao diện gọn gàng",
                      descEn: "Minimal visuals",
                    },
                    {
                      id: "ambient",
                      icon: Waves,
                      descVi: "Ánh sáng êm dịu",
                      descEn: "Soft ambient aura",
                    },
                    {
                      id: "focus",
                      icon: Focus,
                      descVi: "Nền tối chuyên sâu",
                      descEn: "High concentration",
                    },
                    {
                      id: "party",
                      icon: Flame,
                      descVi: "Ánh sáng lung linh",
                      descEn: "Vibrant dynamics",
                    },
                  ] as const
                ).map(({ id, icon: Icon, descVi, descEn }) => {
                  const isSelected = atmosphere === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={pending}
                      onClick={() => setAtmosphere(id)}
                      className={`rounded-[6px] border p-3 text-left transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? "border-[var(--border-loft)] bg-[#101113]/10 text-[var(--text-loft-primary)] shadow-sm ring-1 ring-[var(--accent-blue)]/40"
                          : "border-[var(--border-loft)] bg-[var(--bg-loft-card)] hover-invert hover:bg-[var(--border-loft-light)] text-[var(--text-loft-secondary)]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div
                          className={`w-6 h-6 rounded-[6px] flex items-center justify-center ${
                            isSelected
                              ? "bg-[#101113] text-white"
                              : "bg-[var(--border-loft)] text-[var(--bg-loft-base)]"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        {isSelected && (
                          <div className="w-4 h-4 rounded-full bg-[#101113] text-white flex items-center justify-center">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] font-medium capitalize text-[var(--text-loft-primary)]">
                        {id}
                      </div>
                      <div className="text-[11px] text-[var(--text-loft-muted)] mt-1">
                        {vi ? descVi : descEn}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Accent Color Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium text-[var(--text-loft-secondary)]">
                    {vi ? "Màu chủ đạo" : "Accent color"}
                  </div>
                  <span className="text-[11px] font-medium capitalize text-[var(--text-loft-primary)]">
                    {accent}
                  </span>
                </div>
                <div
                  className="grid grid-cols-5 gap-1"
                  role="radiogroup"
                  aria-label={vi ? "Màu chủ đạo" : "Accent color"}
                >
                  {(["blue", "purple", "green", "orange", "rose"] as const).map((opt) => {
                    const isSelected = accent === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={pending}
                        onClick={() => setAccent(opt)}
                        aria-label={vi ? ({ blue: "Xanh", purple: "Tím", green: "Lục", orange: "Cam", rose: "Hồng" } as const)[opt] : opt}
                        data-accent={opt}
                        className="kott-accent-option min-h-10 border px-1 cursor-pointer"
                      >
                        {vi ? ({ blue: "Xanh", purple: "Tím", green: "Lục", orange: "Cam", rose: "Hồng" } as const)[opt] : opt}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Adaptive media background */}
              <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--border-loft)]">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Music className="w-3.5 h-3.5 text-[var(--text-loft-muted)]" />
                  <span className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                    {vi ? "Tự điều chỉnh theo media đang phát" : "Adapt to shared media"}
                  </span>
                </div>
                <Switch
                  checked={adaptiveMedia}
                  disabled={pending}
                  onChange={setAdaptiveMedia}
                  aria-label={vi ? "Tự điều chỉnh theo media đang phát" : "Adapt to shared media"}
                />
              </div>
            </fieldset>
          )}

          {/* Sound & SFX Section */}
          <fieldset className="p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 space-y-4">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[var(--text-loft-muted)]" />
              <legend className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
                {vi ? "Âm thanh" : "Sounds"}
              </legend>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                {vi ? "Hiệu ứng âm thanh" : "Sound effects"}
              </span>
              <Switch
                checked={soundEffectsEnabled}
                disabled={pending}
                onChange={setSoundEffectsEnabled}
                aria-label={vi ? "Hiệu ứng âm thanh" : "Sound effects"}
              />
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[var(--border-loft)]">
              <span className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                {vi ? "Âm thanh trong phòng" : "Room sounds"}
              </span>
              <Switch
                checked={roomSoundsEnabled}
                disabled={pending}
                onChange={setRoomSoundsEnabled}
                aria-label={vi ? "Âm thanh trong phòng" : "Room sounds"}
              />
            </div>

            <div className="pt-3 border-t border-[var(--border-loft)] space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-loft-secondary)] font-medium">
                  {vi ? "Âm lượng hiệu ứng" : "Effects volume"}
                </span>
                <span className="font-medium text-[var(--text-loft-primary)] px-2 py-1 rounded-[6px] bg-[var(--border-loft-light)] text-[11px]">
                  {sfxVolume}%
                </span>
              </div>
              <input
                className="w-full accent-[#101113] cursor-pointer"
                type="range"
                min={0}
                max={100}
                value={sfxVolume}
                disabled={pending}
                onChange={(e) => setSfxVolume(Number(e.target.value))}
              />
            </div>
          </fieldset>

          {/* Feedback error */}
          {error && (
            <p role="alert" className="p-4 rounded-[6px] bg-[#101113]/10 border border-[var(--border-loft)]/30 text-[var(--text-loft-primary)] text-[11px] leading-relaxed">
              {error}
            </p>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/80 backdrop-blur-md flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2 rounded-[6px] border border-[var(--border-loft)] text-[11px] font-medium hover-invert hover:bg-[var(--border-loft-light)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)]"
          >
            {vi ? "Hủy" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-2 rounded-[6px] bg-[#101113] hover:bg-[#101113] text-white text-[11px] font-medium flex items-center gap-2 transition-all disabled:opacity-50 shadow-md shadow-[#101113]/20 active:scale-97 cursor-pointer"
          >
            {pending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{vi ? "Đang lưu…" : "Saving…"}</span>
              </>
            ) : (
              <span>{vi ? "Lưu" : "Save"}</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
