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
import {
  Link2,
  Lock,
  LockOpen,
  CheckCircle2,
  Headphones,
  BadgeCheck,
  Radio,
  Globe,
  LogIn,
  Check,
  AudioWaveform,
  Users2,
  Clock,
} from "lucide-react";

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

  return (
    <div className="h-dvh w-full flex flex-col bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)] relative overflow-hidden selection:bg-[#0066CC]/30">
      {/* Top Shared Lobby Header */}
      <LobbyHeader />

      {/* Main Spatial Stage Body */}
      <main className="flex-1 min-h-0 w-full pt-14 flex flex-col items-center justify-center px-3 sm:px-6 py-3 sm:py-6 relative">
        {/* Ethereal Ambient Lounge Lights */}
        <div
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[480px] bg-gradient-to-b from-[#0066CC]/20 via-[#2193fb]/10 to-transparent rounded-full blur-3xl -z-10 animate-pulse"
          style={{ animationDuration: "6s" }}
        />
        <div className="pointer-events-none absolute top-1/3 -left-48 w-80 h-80 bg-[#0066CC]/10 rounded-full blur-[100px] -z-10" />
        <div
          className="pointer-events-none absolute bottom-12 -right-40 w-96 h-96 bg-[#2193fb]/15 rounded-full blur-[120px] -z-10 animate-pulse"
          style={{ animationDuration: "8s" }}
        />

        {/* Centered 480px Spatial Enclosure */}
        <div className="w-full max-w-[480px] py-1 flex flex-col gap-2 sm:gap-4 z-10">
          {/* Top Ambient Pill Header */}
          <div className="hidden sm:flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#0066CC] shadow-[0_0_8px_#0066CC] animate-ping" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-loft-secondary)]">
                {l("Instant Portal Link", "Liên kết vào phòng ngay")}
              </span>
            </div>
            <div className={`flex items-center gap-1.5 ${room?.is_locked ? "text-amber-500" : "text-[#0066CC]"} text-xs font-medium bg-[var(--bg-loft-surface)] px-2.5 py-1 rounded-full border border-[var(--border-loft)] shadow-xs`}>
              {room?.is_locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
              <span>{room?.is_locked ? l("Room locked", "Phòng đã khóa") : l("Open Session", "Phiên đang mở")}</span>
            </div>
          </div>

          {/* Universal Input Field (Validated Link State) */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_ENTRANCE }}
            className="relative group"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-r from-[#0066CC]/40 via-[#2193fb]/30 to-[#0066CC]/40 rounded-xl blur-xs opacity-75 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative flex items-center justify-between bg-[var(--bg-loft-card)] px-4 py-3 rounded-xl shadow-lg border border-[var(--border-loft)]">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Link2 className="w-4 h-4 text-[#0066CC] shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-semibold uppercase text-[var(--text-loft-muted)]">
                    {l("Target Space", "Phòng đích")}
                  </span>
                  <span className="text-xs sm:text-sm font-medium text-[var(--text-loft-primary)] truncate select-all">
                    /join/{room?.slug ?? roomId}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-[#34c759]/15 text-[#34c759] px-2.5 py-1 rounded-full shrink-0 border border-[#34c759]/25">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-wider font-bold">
                  {room ? l("Valid", "Hợp lệ") : l("Checking", "Đang kiểm tra")}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Expanded Room Preview Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.38, delay: 0.05, ease: EASE_ENTRANCE }}
            className="relative rounded-2xl bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Subtle Top Image Backdrop Ambient Texture */}
            <div className="relative h-16 sm:h-28 w-full overflow-hidden bg-gradient-to-r from-[#18181E] via-[#202028] to-[#141419]">
              <img
                src="https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=800&q=80"
                alt={l("Co-working ambient space", "Không gian làm việc chung")}
                className="w-full h-full object-cover object-center opacity-35 mix-blend-luminosity scale-105 transition-transform duration-700 hover:scale-100"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-loft-card)] via-[var(--bg-loft-card)]/60 to-transparent" />

              {/* Live Status Over Glass */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-white">
                  <span className="w-2 h-2 rounded-full bg-[#34c759] shadow-[0_0_6px_#34c759] animate-pulse" />
                  <span className="text-xs font-semibold tracking-wide">
                    {l("Room ready", "Phòng đã sẵn sàng")}
                  </span>
                </div>
                <div className="bg-[#0066CC]/20 text-[#0066CC] border border-[#0066CC]/30 backdrop-blur-md px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-medium">
                  <Headphones className="w-3.5 h-3.5" />
                  <span>{l("Live media", "Âm thanh và hình ảnh trực tiếp")}</span>
                </div>
              </div>
            </div>

            {/* Room Meta & Body Content */}
            <div className="px-4 sm:px-5 pt-2 pb-3 sm:pb-5 flex flex-col gap-2.5 sm:gap-3.5">
              {/* Title & Topic Area */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-[var(--text-loft-primary)] tracking-tight">
                    {room?.name ?? l("Loading room…", "Đang tải phòng…")}
                  </h2>
                  <span className="bg-[var(--border-loft)] text-[var(--text-loft-secondary)] px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider">
                    {room?.allow_guests ? l("Public", "Công khai") : l("Private", "Riêng tư")}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-loft-secondary)]">
                  {l("Realtime voice, video, screen share, and chat", "Trò chuyện thoại, video, chia sẻ màn hình và nhắn tin trực tiếp")}
                </p>
              </div>

              {/* Spatial Host & Live Participant Mosaic */}
              <div className="hidden sm:flex items-center justify-between p-3 rounded-xl bg-[var(--bg-loft-surface)] border border-[var(--border-loft)]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase text-[var(--text-loft-muted)] tracking-wider">
                    {l("Spatial Anchor", "Chủ phòng")}
                  </span>
                  <span className="text-xs sm:text-sm text-[var(--text-loft-primary)] flex items-center gap-1.5">
                    {l("Host identity", "Danh tính chủ phòng")}{" "}
                    <span className="font-semibold text-[#0066CC]">
                      {l("verified by Mingly", "được Mingly xác minh")}
                    </span>
                    <BadgeCheck className="w-4 h-4 text-[#0066CC]" />
                  </span>
                </div>

                <Users2 className="w-6 h-6 text-[#0066CC]" />
              </div>

              {/* Active Audio State Sync */}
              <div className="hidden sm:flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--bg-loft-surface)] border border-[var(--border-loft)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-[var(--bg-loft-base)] flex items-center justify-center text-[#0066CC] shrink-0 border border-[var(--border-loft)]">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] font-semibold uppercase text-[var(--text-loft-muted)]">
                      {l("Shared Stream", "Luồng chia sẻ")}
                    </span>
                    <span className="text-xs font-medium text-[var(--text-loft-primary)] truncate">
                      {l("LiveKit media channel", "Kênh truyền thông LiveKit")}
                    </span>
                  </div>
                </div>

                {/* Animated Audio Equalizer Bars */}
                <div className="flex items-end gap-1 h-4 shrink-0 px-2">
                  <span
                    className="w-1 bg-[#0066CC] rounded-full animate-pulse h-2"
                    style={{ animationDuration: "700ms" }}
                  />
                  <span
                    className="w-1 bg-[#2193fb] rounded-full animate-pulse h-4"
                    style={{
                      animationDelay: "150ms",
                      animationDuration: "600ms",
                    }}
                  />
                  <span
                    className="w-1 bg-[#0066CC] rounded-full animate-pulse h-3"
                    style={{
                      animationDelay: "300ms",
                      animationDuration: "800ms",
                    }}
                  />
                  <span
                    className="w-1 bg-[#2193fb] rounded-full animate-pulse h-2"
                    style={{
                      animationDelay: "75ms",
                      animationDuration: "550ms",
                    }}
                  />
                </div>
              </div>

              {/* Policy Indicator */}
              <div className="flex items-center gap-2 text-[var(--text-loft-secondary)] text-xs px-1">
                <Globe className="w-4 h-4 text-[#0066CC]" />
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
            <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0 flex flex-col gap-2 sm:gap-2.5">
              {room?.allow_guests && (
                <input
                  value={displayName}
                  maxLength={48}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={l("Your display name (optional)", "Tên hiển thị của bạn (không bắt buộc)")}
                  aria-label={l("Display name", "Tên hiển thị")}
                  className="w-full h-11 px-3.5 rounded-xl bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] outline-none focus:border-[#0066CC] text-sm"
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
                  className="w-full h-11 px-3.5 rounded-xl bg-[var(--bg-loft-surface)] border border-[var(--border-loft)] outline-none focus:border-[#0066CC] text-sm"
                />
              )}
              {error && (
                <p role="alert" className="text-xs text-[#FF3B30]">
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
                  className="btn-press w-full group relative overflow-hidden flex items-center justify-center gap-2 bg-[#0066CC] hover:bg-[#0077ED] active:scale-[0.98] text-white text-sm font-semibold py-3 px-4 rounded-xl shadow-lg shadow-[#0066CC]/25 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                >
                  {joinStep === "connecting" ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{l("Connecting as Guest...", "Đang kết nối với tư cách khách...")}</span>
                    </>
                  ) : joinStep === "entering" ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{l("Entering Space...", "Đang vào phòng...")}</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                      <span>{l("Join as Guest", "Vào với tư cách khách")}</span>
                      <span className="text-[10px] uppercase bg-white/20 text-white px-2 py-0.5 rounded-full ml-1 font-normal">
                        {l("Instant", "Tức thì")}
                      </span>
                    </>
                  )}
                </button>
              )}

              {/* Secondary CTA: Google Auth Integration */}
              <button
                type="button"
                disabled={!room}
                onClick={() => void handleGoogleSignIn()}
                className="btn-press w-full flex items-center justify-center gap-2.5 bg-[var(--bg-loft-surface)] hover:bg-[var(--border-loft)] active:scale-[0.98] text-[var(--text-loft-primary)] text-sm font-medium py-3 px-4 rounded-xl border border-[var(--border-loft)] transition-all duration-150 cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    fill="#EA4335"
                  />
                </svg>
                <span>
                  {hasSession
                    ? l("Join with your account", "Vào bằng tài khoản của bạn")
                    : l("Sign in with Google to Join", "Đăng nhập Google để vào phòng")}
                </span>
              </button>

              {/* Micro Helper Note */}
              <p className="hidden sm:block text-center text-xs text-[var(--text-loft-muted)] pt-1">
                {room?.password_required
                  ? l("Enter the room password to join. No account is required.", "Nhập mật khẩu phòng để tham gia. Không cần tài khoản.")
                  : l("No password or signup required. You can choose your avatar and name next.", "Không cần mật khẩu hay đăng ký. Bạn có thể chọn ảnh đại diện và tên sau.")}
              </p>
            </div>
          </motion.div>

          {/* Quick Room Feature Badges */}
          <div className="hidden sm:grid grid-cols-3 gap-2.5 pt-1">
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-[var(--bg-loft-surface)]/80 border border-[var(--border-loft)] text-center gap-1 shadow-xs">
              <AudioWaveform className="w-5 h-5 text-[#0066CC]" />
              <span className="text-[11px] font-medium text-[var(--text-loft-secondary)]">
                {l("Lossless Sync", "Đồng bộ chất lượng cao")}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-[var(--bg-loft-surface)]/80 border border-[var(--border-loft)] text-center gap-1 shadow-xs">
              <Users2 className="w-5 h-5 text-[#2193fb]" />
              <span className="text-[11px] font-medium text-[var(--text-loft-secondary)]">
                {l("Drop-in Audio", "Trò chuyện thoại tức thì")}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-[var(--bg-loft-surface)]/80 border border-[var(--border-loft)] text-center gap-1 shadow-xs">
              <Clock className="w-5 h-5 text-[#0066CC]" />
              <span className="text-[11px] font-medium text-[var(--text-loft-secondary)]">
                {l("Zero Sign-up", "Không cần đăng ký")}
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Spatial Footer */}
      <footer className="hidden sm:block w-full bg-[var(--bg-loft-base)]/90 backdrop-blur-md py-2.5 border-t border-[var(--border-loft)]">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between text-[var(--text-loft-muted)] text-[11px] gap-1">
          <span>
            {l("Mingly • Realtime audio, video & screen share", "Mingly • Đồng bộ âm thanh và hình ảnh trực tiếp")}
          </span>
          <span>{l("v2.4 • Clean presence", "v2.4 • Kết nối tự nhiên")}</span>
        </div>
      </footer>
    </div>
  );
}
