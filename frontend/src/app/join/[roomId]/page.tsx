"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { getSupabase, signInWithGoogle } from "@/lib/supabase/client";
import { api, saveCredential } from "@/lib/api";
import type { ApiRoomPreview } from "@/types/api";
import { EASE_ENTRANCE } from "@/lib/motion";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useUIText } from "@/lib/i18n/uiText";
import { Globe, Lock, LockOpen, LogIn, Check } from "lucide-react";

export default function RoomJoinPage() {
  const { locale } = useTranslation();
  const l = useCallback((english: string, vietnamese: string) => locale === "vi" ? vietnamese : english, [locale]);
  const tr = useUIText();
  const params = useParams();
  const router = useRouter();
  const roomId = String(params?.roomId || "");

  const [isJoiningGuest, setIsJoiningGuest] = useState(false);
  const [joinStep, setJoinStep] = useState<"idle" | "connecting" | "entering">(
    "idle",
  );
  const [room, setRoom] = useState<ApiRoomPreview | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api.resolveRoom(roomId, controller.signal)
      .then((resolved) => {
        setRoom(resolved.room);
        if (/^\d{6}$/.test(resolved.room.slug) && resolved.room.slug !== roomId) {
          router.replace(`/join/${encodeURIComponent(resolved.room.slug)}`);
        }
      })
      .catch((caught: Error) => {
        if (caught.name !== "AbortError")
          setError(caught.message || l("Room not found", "Không tìm thấy phòng"));
      });
    return () => controller.abort();
  }, [roomId, l, router]);

  useEffect(() => {
    let active = true;
    void getSupabase()?.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    }).catch(() => {
      if (active) setHasSession(false);
    });
    return () => { active = false; };
  }, []);

  const handleJoinGuest = async () => {
    if (!room) return;
    const name = displayName.trim();
    if (name.length === 1) {
      setError(l("Display name must be at least 2 characters, or leave it blank.", "Tên hiển thị phải có ít nhất 2 ký tự, hoặc để trống."));
      return;
    }
    setIsJoiningGuest(true);
    setJoinStep("connecting");
    setError(null);
    try {
      const guest = await api.createGuest(room.id, name || l("Guest", "Khách"), password);
      saveCredential(room.id, {
        token: guest.token,
        type: "guest",
        roomId: guest.room_id,
        displayName: guest.display_name,
      });
      setJoinStep("entering");
      router.push(`/room/${encodeURIComponent(room.slug)}`);
    } catch (caught) {
      setJoinStep("idle");
      setIsJoiningGuest(false);
      setError(
        caught instanceof Error ? caught.message : l("Could not join room", "Không thể vào phòng"),
      );
    }
  };

  const handleGoogleSignIn = async () => {
    if (!room) return;
    if (hasSession) {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) return;
      try {
        const me = await api.me(session.access_token);
        saveCredential(room.id, {
          token: session.access_token,
          type: "user",
          roomId: room.id,
          displayName: me.display_name,
        });
        router.push(`/room/${encodeURIComponent(room.slug)}`);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : l("Could not join room", "Không thể vào phòng"),
        );
      }
      return;
    }
    try {
      await signInWithGoogle(`/room/${encodeURIComponent(room.slug)}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : l("Could not start Google sign-in", "Không thể bắt đầu đăng nhập Google"),
      );
    }
  };

  if (error && !room) {
    return (
      <div className="min-h-dvh w-full bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)]">
        <LobbyHeader />
        <main className="flex min-h-dvh items-center justify-center px-4 pt-14">
          <section className="w-full max-w-sm rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 text-center shadow-xl">
            <h1 className="text-base font-medium">{l("This room is unavailable", "Phòng này không khả dụng")}</h1>
            <p className="mt-2 text-[11px] text-[var(--text-loft-secondary)]">
              {l("It may not exist or may have ended.", "Phòng có thể không tồn tại hoặc đã kết thúc.")}
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-5 rounded-[6px] bg-[#101113] px-4 py-2 text-[11px] font-medium text-white"
            >
              {l("Back to home", "Về trang chủ")}
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full flex flex-col bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)] relative overflow-hidden selection:bg-[#101113]/30">
      {/* Top Shared Lobby Header */}
      <LobbyHeader />

      {/* Main Spatial Stage Body */}
      <main className="flex-1 min-h-0 w-full pt-12 flex flex-col items-center justify-center px-3 sm:px-6 py-3 sm:py-6 relative">
        {/* Ethereal Ambient Lounge Lights */}
        <div
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[480px] bg-gradient-to-b from-[#101113]/20 via-[#101113]/10 to-transparent rounded-full blur-3xl -z-10 animate-pulse"
          style={{ animationDuration: "1150ms" }}
        />
        <div className="pointer-events-none absolute top-1/3 -left-48 w-80 h-80 bg-[#101113]/10 rounded-full blur-[100px] -z-10" />
        <div
          className="pointer-events-none absolute bottom-12 -right-40 w-96 h-96 bg-[#101113]/15 rounded-full blur-[120px] -z-10 animate-pulse"
          style={{ animationDuration: "1150ms" }}
        />

        {/* Centered 480px Spatial Enclosure */}
        <div className="w-full max-w-[480px] py-1 flex flex-col gap-2 sm:gap-4 z-10">
          {/* Top Ambient Pill Header */}
          <div className="hidden sm:flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#101113] shadow-[0_0_8px_#101113] animate-ping" />
              <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-loft-secondary)]">
                {l("Room", "Phòng")}
              </span>
            </div>
            <div className={`flex items-center gap-2 ${room?.is_locked ? "text-[var(--text-loft-secondary)]" : "text-[var(--text-loft-primary)]"} text-[11px] font-medium bg-[var(--bg-loft-surface)] px-3 py-1 rounded-full border border-[var(--border-loft)] shadow-xs`}>
              {room?.is_locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
              <span>{room?.is_locked ? l("Locked", "Đã khóa") : l("Open", "Đang mở")}</span>
            </div>
          </div>

          {/* Expanded Room Preview Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.05, ease: EASE_ENTRANCE }}
            className="relative rounded-[6px] bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Subtle Top Image Backdrop Ambient Texture */}
            <div className="relative h-16 sm:h-28 w-full overflow-hidden bg-gradient-to-r from-[#101113] via-[#101113] to-[#101113]">
              <img
                src="https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=800&q=80"
                alt={l("Co-working ambient space", "Không gian làm việc chung")}
                className="w-full h-full object-cover object-center opacity-35 mix-blend-luminosity scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-loft-card)] via-[var(--bg-loft-card)]/60 to-transparent" />

            </div>

            {/* Room Meta & Body Content */}
            <div className="px-4 sm:px-5 pt-2 pb-3 sm:pb-5 flex flex-col gap-3 sm:gap-4">
              {/* Title & Topic Area */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-medium text-[var(--text-loft-primary)] tracking-tight">
                    {room?.name ?? l("Loading room…", "Đang tải phòng…")}
                  </h2>
                  <span className="bg-[var(--border-loft)] text-[var(--bg-loft-base)] px-2 py-1 rounded-[6px] text-[11px] font-medium uppercase tracking-wider">
                    {room?.allow_guests ? l("Public", "Công khai") : l("Private", "Riêng tư")}
                  </span>
                </div>
              </div>

              {/* Policy Indicator */}
              <div className="flex items-center gap-2 text-[var(--text-loft-secondary)] text-[11px] px-1">
                <Globe className="w-4 h-4 text-[var(--text-loft-primary)]" />
                <span>
                  {l("Guest Access:", "Quyền truy cập của khách:")}{" "}
                  <strong className="text-[var(--text-loft-primary)] font-medium">
                    {room?.allow_guests
                      ? l("Open to everyone", "Mọi người đều có thể vào")
                      : l("Disabled by host", "Chủ phòng đã tắt")}
                  </strong>
                </span>
              </div>
            </div>

            {/* Dual Action Section */}
            <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0 flex flex-col gap-2 sm:gap-3">
              {room?.allow_guests && (
                <input
                  value={displayName}
                  maxLength={48}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={l("Your display name (optional)", "Tên hiển thị của bạn (không bắt buộc)")}
                  aria-label={l("Display name", "Tên hiển thị")}
                  className="w-full h-11 px-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] outline-none focus:border-[var(--border-loft)] text-[11px]"
                />
              )}
              {room?.password_required && (
                <input
                  type="password"
                  value={password}
                  maxLength={256}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={l("Room password", "Mật khẩu phòng")}
                  aria-label={l("Room password", "Mật khẩu phòng")}
                  className="w-full h-11 px-4 rounded-[6px] bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] outline-none focus:border-[var(--border-loft)] text-[11px]"
                />
              )}
              {error && (
                <p role="alert" className="text-[11px] text-[var(--text-loft-primary)]">
                  {tr(error)}
                </p>
              )}
              {/* Primary CTA: One-click Guest Entry */}
              {room?.allow_guests && (
                <button
                  id="guest-join-btn"
                  type="button"
                  disabled={isJoiningGuest}
                  onClick={() => void handleJoinGuest()}
                  className="btn-press w-full group relative overflow-hidden flex items-center justify-center gap-2 bg-[#101113] hover:bg-[#101113] active:scale-[0.98] text-white text-[11px] font-medium py-3 px-4 rounded-[6px] shadow-lg shadow-[#101113]/25 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                >
                  {joinStep === "connecting" ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{l("Joining...", "Đang tham gia...")}</span>
                    </>
                  ) : joinStep === "entering" ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{l("Joining...", "Đang tham gia...")}</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                      <span>{l("Join", "Tham gia")}</span>
                    </>
                  )}
                </button>
              )}

              {/* Secondary CTA: Google Auth Integration */}
              <button
                type="button"
                disabled={!room}
                onClick={() => void handleGoogleSignIn()}
                className="btn-press w-full flex items-center justify-center gap-3 bg-[var(--bg-loft-surface)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] active:scale-[0.98] text-[var(--text-loft-primary)] text-[11px] font-medium py-3 px-4 rounded-[6px] border border-[var(--border-loft)] transition-all duration-200 cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    fill="currentColor"
                  />
                  <path
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                    fill="currentColor"
                  />
                  <path
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    fill="currentColor"
                  />
                  <path
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    fill="currentColor"
                  />
                </svg>
                <span>
                  {hasSession
                    ? l("Join", "Tham gia")
                    : l("Sign in", "Đăng nhập")}
                </span>
              </button>

            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
