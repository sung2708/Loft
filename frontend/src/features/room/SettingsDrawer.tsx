"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
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
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { useRoomStore } from "@/stores/useRoomStore";
import { useUIStore } from "@/stores/useUIStore";
import { useSfxStore } from "@/stores/useSfxStore";
import { useRoomSession } from "./RoomSession";
import { useI18nStore } from "@/lib/i18n/useTranslation";
import type { RoomAccent, RoomAtmosphere } from "@/types/api";

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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] focus:ring-offset-2 focus:ring-offset-[var(--bg-loft-card)] disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "border-[#101113] bg-[#101113] dark:border-[#f4f5f7] dark:bg-[#f4f5f7]" : "border-[#101113] bg-[#d1d5db] dark:border-[#f4f5f7] dark:bg-[#4a4d52]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5 bg-white dark:bg-[#101113]" : "translate-x-0 bg-[#101113] dark:bg-[#f4f5f7]"
        }`}
      />
    </button>
  );
}

export function SettingsDrawer() {
  const room = useRoomStore((state) => state.room);
  const self = useRoomStore((state) => state.self);
  const isHost = self?.role === "host";
  const locale = useI18nStore((state) => state.locale);
  const vi = locale === "vi";
  const session = useRoomSession();
  const setAppearancePreview = useUIStore((state) => state.setRoomAppearancePreview);
  const clearAppearancePreview = useUIStore((state) => state.clearRoomAppearancePreview);
  const close = useCallback(() => {
    clearAppearancePreview();
    useUIStore.getState().closeDrawer();
  }, [clearAppearancePreview]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  const [name, setName] = useState(room?.name ?? "");
  const [allowGuests, setAllowGuests] = useState(room?.allow_guests ?? true);
  const [passwordEnabled, setPasswordEnabled] = useState(room?.password_required ?? false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [locked, setLocked] = useState(room?.is_locked ?? false);
  const [atmosphere, setAtmosphere] = useState<RoomAtmosphere>(room?.atmosphere ?? "ambient");
  const [accent, setAccent] = useState<RoomAccent>(room?.accent ?? "blue");
  const [adaptiveMedia, setAdaptiveMedia] = useState(room?.adaptive_media_background ?? true);

  const soundEffectsEnabled = useSfxStore((state) => state.soundEffectsEnabled);
  const roomSoundsEnabled = useSfxStore((state) => state.roomSoundsEnabled);
  const sfxVolume = useSfxStore((state) => state.volume);
  const setSoundEffectsEnabled = useSfxStore((state) => state.setSoundEffectsEnabled);
  const setRoomSoundsEnabled = useSfxStore((state) => state.setRoomSoundsEnabled);
  const setSfxVolume = useSfxStore((state) => state.setVolume);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const hasAppearancePreview = Boolean(
    isHost && room && (
      atmosphere !== room.atmosphere ||
      accent !== room.accent ||
      adaptiveMedia !== room.adaptive_media_background
    ),
  );

  useEffect(() => () => clearAppearancePreview(), [clearAppearancePreview]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!room || !isHost) return;
    setPending(true);
    setError(null);
    setSavedSuccess(false);

    try {
      const token =
        (await getSupabase()?.auth.getSession())?.data.session?.access_token ??
        session.token ??
        "";

      let currentVersion = room.version;
      const appearanceChanged =
        isHost &&
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

      if (appearanceChanged) {
        session.sendCommand("room.appearance.update", {
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

      useRoomStore.getState().roomUpdated(updated);
      clearAppearancePreview();
      setPassword("");
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : vi
            ? "Không thể lưu cài đặt"
            : "Could not save settings",
      );
    } finally {
      setPending(false);
    }
  };

  if (!room) return null;

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className="kott-settings fixed top-14 right-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex w-full flex-col border-l md:relative md:top-auto md:right-auto md:bottom-auto md:z-auto md:h-full md:w-96 md:shrink-0"
    >
      {/* Header */}
      <div className="kott-settings__header h-14 px-5 flex items-center justify-between border-b shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-[6px] bg-[#101113]/15 text-[var(--text-loft-primary)] flex items-center justify-center">
            <Sliders className="w-4 h-4" />
          </div>
          <h3 className="font-medium uppercase tracking-wide">{vi ? "Cài đặt phòng" : "Room settings"}</h3>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={vi ? "Đóng" : "Close"}
          className="w-8 h-8 rounded-full hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] flex items-center justify-center transition-colors text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Form Content */}
      <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {isHost ? (
            <>
          {/* Room Name & Access Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
                {vi ? "Thông tin chung" : "General"}
              </h4>
            </div>

            {/* Room Name Card */}
            <div className="rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-medium text-[var(--text-loft-secondary)]">
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

            {/* Allow Guests Switch Card */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60">
              <div className="min-w-0 pr-2">
                <div className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                  {vi ? "Cho phép khách vào" : "Allow guests"}
                </div>
              </div>
              <Switch
                checked={allowGuests}
                disabled={pending}
                onChange={setAllowGuests}
                aria-label={vi ? "Cho phép khách vào" : "Allow guests"}
              />
            </div>
          </section>

          {/* Security & Access Section */}
          <section className="space-y-3">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
              {vi ? "Bảo mật & Quyền vào" : "Security & Access"}
            </h4>

            {/* Password protection card */}
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
                <div className="relative pt-1 border-t border-[var(--border-loft)]">
                  <label className="block text-[11px] font-medium text-[var(--text-loft-secondary)] mb-1">
                    {room.password_required
                      ? vi
                        ? "Thay đổi mật khẩu (để trống nếu giữ nguyên)"
                        : "Change password (leave blank to keep current)"
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
                            ? "Mật khẩu mới..."
                            : "New password..."
                          : vi
                            ? "Nhập mật khẩu (tối thiểu 4 ký tự)..."
                            : "Enter password (min 4 chars)..."
                      }
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

            {/* Lock room toggle card */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60">
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <div className="w-7 h-7 rounded-[6px] bg-[#26282c]/10 text-[var(--text-loft-secondary)] flex items-center justify-center shrink-0">
                  <Shield className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[var(--text-loft-primary)] flex items-center gap-2">
                    <span>{vi ? "Khóa phòng với người mới" : "Lock room"}</span>
                    {locked && (
                      <span className="px-2 py-1 rounded-[6px] bg-[#26282c]/15 text-[var(--text-loft-secondary)] dark:text-[var(--text-loft-secondary)] text-[11px] font-medium">
                        {vi ? "Đã khóa" : "Locked"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Switch
                checked={locked}
                disabled={pending}
                onChange={setLocked}
                aria-label={vi ? "Khóa phòng với người mới" : "Lock room"}
              />
            </div>
          </section>

            </>
          ) : (
            <section className="rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 p-4">
              <p className="text-[11px] text-[var(--text-loft-secondary)]">
                {vi ? "Chỉ chủ phòng có thể thay đổi cài đặt phòng." : "Only the room host can change room settings."}
              </p>
            </section>
          )}

          {/* Atmosphere & Theme (Host only) */}
          {isHost && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--text-loft-primary)]" />
                <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
                  {vi ? "Không khí phòng" : "Room atmosphere"}
                </h4>
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
                      viTitle: "Tối giản",
                      enTitle: "Clean",
                      viDesc: "Giao diện gọn gàng",
                      enDesc: "Minimal visuals",
                    },
                    {
                      id: "ambient",
                      icon: Waves,
                      viTitle: "Dịu nhẹ",
                      enTitle: "Subtle",
                      viDesc: "Ánh sáng êm dịu",
                      enDesc: "Soft ambient aura",
                    },
                    {
                      id: "focus",
                      icon: Focus,
                      viTitle: "Tập trung",
                      enTitle: "Deep",
                      viDesc: "Nền tối chuyên sâu",
                      enDesc: "High concentration",
                    },
                    {
                      id: "party",
                      icon: Flame,
                      viTitle: "Sôi động",
                      enTitle: "Dynamic",
                      viDesc: "Ánh sáng lung linh",
                      enDesc: "Vibrant dynamics",
                    },
                  ] as const
                ).map(({ id, icon: Icon, viTitle, enTitle }) => {
                  const isSelected = atmosphere === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      data-atmosphere={id}
                      aria-checked={isSelected}
                      disabled={pending}
                      onClick={() => {
                        setAtmosphere(id);
                        setAppearancePreview({ atmosphere: id, accent, adaptiveMediaBackground: adaptiveMedia });
                      }}
                      className={`relative rounded-[6px] border p-3 text-left transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? "border-[var(--border-loft)] bg-[#101113]/10 text-[var(--text-loft-primary)] shadow-sm ring-1 ring-[var(--accent-blue)]/40"
                          : "border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 hover-invert hover:bg-[var(--border-loft-light)] text-[var(--text-loft-secondary)]"
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
                      <div className="font-medium">{vi ? viTitle : enTitle}</div>
                    </button>
                  );
                })}
              </div>

              <div
                className="appearance-preview"
                data-atmosphere={atmosphere}
                data-accent={accent}
                data-preview={hasAppearancePreview ? "true" : "false"}
                aria-live="polite"
              >
                <div className="appearance-preview__stage" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div>
                  <div className="font-medium text-[var(--text-loft-primary)]">
                    {vi ? "Xem trước trên màn hình này" : "Preview on this screen"}
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--text-loft-secondary)]">
                    {hasAppearancePreview
                      ? vi ? "Lưu để áp dụng cho mọi người trong phòng." : "Save to apply it for everyone in the room."
                      : vi ? "Chọn một kiểu để xem thay đổi trước khi lưu." : "Choose a style to preview it before saving."}
                  </p>
                </div>
              </div>

              {/* Accent Color Picker */}
              <div className="p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 space-y-3">
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
                        onClick={() => {
                          setAccent(opt);
                          setAppearancePreview({ atmosphere, accent: opt, adaptiveMediaBackground: adaptiveMedia });
                        }}
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
              <div className="flex items-center justify-between gap-3 p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60">
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-7 h-7 rounded-[6px] bg-[#101113]/15 text-[var(--text-loft-primary)] flex items-center justify-center shrink-0">
                    <Music className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                      {vi ? "Tự điều chỉnh theo media đang phát" : "Adapt to shared media"}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={adaptiveMedia}
                  disabled={pending}
                  onChange={(next) => {
                    setAdaptiveMedia(next);
                    setAppearancePreview({ atmosphere, accent, adaptiveMediaBackground: next });
                  }}
                  aria-label={vi ? "Tự điều chỉnh theo media đang phát" : "Adapt to shared media"}
                />
              </div>
            </section>
          )}

          {/* Sound & SFX Preferences */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[var(--text-loft-muted)]" />
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-loft-muted)]">
                {vi ? "Âm thanh" : "Audio & SFX"}
              </h4>
            </div>

            <div className="p-4 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]/60 space-y-4">
              {/* Sound effects toggle */}
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                    {vi ? "Hiệu ứng âm thanh" : "Sound effects"}
                  </div>
                </div>
                <Switch
                  checked={soundEffectsEnabled}
                  onChange={setSoundEffectsEnabled}
                  aria-label={vi ? "Hiệu ứng âm thanh" : "Sound effects"}
                />
              </div>

              {/* Room sounds toggle */}
              <div className="flex items-center justify-between pt-3 border-t border-[var(--border-loft)]">
                <div className="min-w-0 pr-2">
                  <div className="text-[11px] font-medium text-[var(--text-loft-primary)]">
                    {vi ? "Âm thanh trong phòng" : "Room sounds"}
                  </div>
                </div>
                <Switch
                  checked={roomSoundsEnabled}
                  onChange={setRoomSoundsEnabled}
                  aria-label={vi ? "Âm thanh trong phòng" : "Room sounds"}
                />
              </div>

              {/* Effects volume slider */}
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
                  type="range"
                  min={0}
                  max={100}
                  value={sfxVolume}
                  onChange={(e) => setSfxVolume(Number(e.target.value))}
                  className="w-full accent-[#101113] cursor-pointer"
                />
              </div>
            </div>
          </section>

          {/* Feedback banners */}
          {error && (
            <div
              role="alert"
              className="p-4 rounded-[6px] bg-[#101113]/10 border border-[var(--border-loft)]/30 text-[var(--text-loft-primary)] text-[11px] leading-relaxed"
            >
              {error}
            </div>
          )}

          {savedSuccess && (
            <div className="p-4 rounded-[6px] bg-[#101113]/10 border border-[var(--border-loft)]/30 text-[var(--text-loft-primary)] text-[11px] flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[#101113] text-white flex items-center justify-center shrink-0">
                <Check className="w-3 h-3" />
              </div>
              <span className="font-medium">
                {vi ? "Đã lưu cài đặt phòng" : "Room settings saved"}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="kott-settings__footer p-4 border-t flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="px-4 py-2 rounded-[6px] border border-[var(--border-loft)] text-[11px] font-medium hover-invert hover:bg-[var(--border-loft-light)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text-loft-secondary)] hover:text-[var(--bg-loft-base)]"
          >
            {vi ? "Đóng" : "Close"}
          </button>
          {isHost && (
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
                <span>{vi ? "Lưu cho mọi người" : "Save for everyone"}</span>
              )}
            </button>
          )}
        </div>
      </form>
    </motion.aside>
  );
}
