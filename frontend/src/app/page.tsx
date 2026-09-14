"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { DeleteRoomDialog } from "@/components/room/DeleteRoomDialog";
import { LoftMark } from "@/components/brand/LoftMark";
import { useAuth } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useUIText } from "@/lib/i18n/uiText";
import { api } from "@/lib/api";
import { normalizeRoomInput } from "@/lib/roomInput";
import type { ApiRoom, ApiRoomPreview } from "@/types/api";
import { EASE_ENTRANCE, EASE_SPATIAL } from "@/lib/motion";
import {
  Link2,
  CornerDownLeft,
  Terminal,
  ArrowRight,
  ShieldCheck,
  Plus,
  Trash2,
} from "lucide-react";

export default function LobbyPage() {
  const router = useRouter();
  const {
    isLoading: isAuthLoading,
    isAuthenticated,
    session,
    signInWithGoogle,
  } = useAuth();
  const { t, locale } = useTranslation();
  const tr = useUIText();

  const [roomId, setRoomId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [resolvedRoom, setResolvedRoom] = useState<ApiRoomPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentRooms, setRecentRooms] = useState<ApiRoom[]>([]);
  const [deletingRoom, setDeletingRoom] = useState<ApiRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch real owned/recent rooms when authenticated
  useEffect(() => {
    if (!isAuthenticated || !session?.access_token) {
      return;
    }
    let isSubscribed = true;
    void api
      .rooms(session.access_token)
      .then((data) => {
        if (isSubscribed && Array.isArray(data.rooms)) {
          setRecentRooms(data.rooms);
        }
      })
      .catch(() => {
        // Silently omit recent rooms if error occurs
      });
    return () => {
      isSubscribed = false;
    };
  }, [isAuthenticated, session?.access_token]);

  const handleJoin = async () => {
    const normalized = normalizeRoomInput(roomId);
    if (!normalized) {
      setError(t.lobby.enterValidRoom);
      setResolvedRoom(null);
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const { room } = await api.resolveRoom(normalized.value);
      setResolvedRoom(room);
    } catch (caught) {
      setResolvedRoom(null);
      setError(
        caught instanceof Error ? caught.message : t.lobby.roomNotFound,
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCreateRoomAction = () => {
    if (isAuthenticated) {
      router.push("/home?create=1");
    } else {
      void signInWithGoogle("/home?create=1");
    }
  };

  const removeRecentRoom = async () => {
    if (!deletingRoom || deleting) return;
    if (!session?.access_token) {
      setDeleteError(locale === "vi" ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : "Your session expired. Please sign in again.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteRoom(session.access_token, deletingRoom.id);
      setRecentRooms((rooms) => rooms.filter((room) => room.id !== deletingRoom.id));
      setDeletingRoom(null);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : locale === "vi" ? "Không thể xóa phòng" : "Could not delete room");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)] relative overflow-x-hidden selection:bg-[#0066CC]/30">
      {/* Top Shared Lobby Header */}
      <LobbyHeader />

      {/* Main Spatial Stage Body */}
      <main className="flex-1 w-full pt-14 min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-between px-4 sm:px-6 py-8 relative">
        {/* Ambient Lounge Glows */}
        <div
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[360px] bg-gradient-to-b from-[#0066CC]/20 via-[#2193fb]/10 to-transparent rounded-full blur-3xl -z-10 animate-pulse"
          style={{ animationDuration: "7s" }}
        />
        <div className="pointer-events-none absolute top-1/3 -left-48 w-80 h-80 bg-[#0066CC]/10 rounded-full blur-[100px] -z-10" />
        <div
          className="pointer-events-none absolute bottom-16 -right-32 w-96 h-96 bg-[#2193fb]/10 rounded-full blur-[120px] -z-10 animate-pulse"
          style={{ animationDuration: "9s" }}
        />

        {/* Top Constellation / Subtle Presence Nodes */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_ENTRANCE }}
          className="relative flex flex-col items-center gap-2 pt-2 z-10"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[var(--bg-loft-surface)]/80 backdrop-blur-xl border border-[var(--border-loft)] shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0066CC] shadow-[0_0_8px_#0066CC] animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#2193fb]/70" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-loft-muted)]/50" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#0066CC]/30" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-loft-secondary)] ml-1">
              {t.lobby.constellation}
            </span>
          </div>
        </motion.div>

        {/* Central Spatial Anchor Enclosure */}
        <div className="relative w-full max-w-[480px] my-auto py-6 flex flex-col items-center text-center z-10">
          {/* Standalone brand mark */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE_ENTRANCE }}
            className="relative mb-5"
          >
            <LoftMark className="w-16 h-16 text-[var(--brand-mark)]" />
          </motion.div>

          {/* Typography */}
          <motion.h1
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05, ease: EASE_ENTRANCE }}
            className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-loft-primary)] text-balance"
          >
            {t.lobby.heroTitle}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1, ease: EASE_ENTRANCE }}
            className="mt-2 text-sm sm:text-base text-[var(--text-loft-secondary)] max-w-[390px] leading-relaxed"
          >
            {t.lobby.heroSubtitle}
          </motion.p>

          {/* Main Interaction Form Surface */}
          <div className="w-full mt-6 flex flex-col gap-3.5 text-left">
            {/* Input Enclosure */}
            <div className="relative w-full group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-loft-muted)] group-focus-within:text-[#0066CC] transition-colors flex items-center pointer-events-none">
                <Link2 className="w-5 h-5" />
              </div>

              <input
                id="roomInput"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleJoin();
                  }
                }}
                placeholder={t.lobby.inputPlaceholder}
                className="w-full h-12 pl-11 pr-24 rounded-xl bg-[var(--bg-loft-surface)] hover:bg-[var(--border-loft-light)] focus:bg-[var(--bg-loft-surface)] text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] font-normal text-sm outline-none border border-[var(--border-loft)] focus:border-[#0066CC] transition-all duration-200 shadow-xs"
              />
            </div>

            {/* Helper Hint Row */}
            <div className="flex items-center justify-between px-1 text-[var(--text-loft-muted)] text-xs">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>{t.lobby.enterHint}</span>
              </span>
              <span>{t.lobby.roomTypeHint}</span>
            </div>

            {/* Backend-resolved room preview */}
            <AnimatePresence>
              {resolvedRoom && (
                <motion.div
                  id="roomPreviewCard"
                  initial={{ opacity: 0, height: 0, scale: 0.96 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.96 }}
                  transition={{ duration: 0.24, ease: EASE_SPATIAL }}
                  className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-lg transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-[#0066CC]/15 text-[#0066CC] shrink-0">
                        <Terminal className="w-4 h-4" />
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34c759] animate-ping" />
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34c759]" />
                      </div>
                      <div className="flex flex-col text-left min-w-0">
                        <span className="text-sm font-semibold text-[var(--text-loft-primary)] truncate">
                          {resolvedRoom.name}
                        </span>
                        <span className="text-xs text-[var(--text-loft-secondary)] truncate">
                          {resolvedRoom.allow_guests
                            ? t.lobby.guestAccessEnabled
                            : t.lobby.signInRequired}
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-[#0066CC]/15 text-[#0066CC] text-[10px] font-bold uppercase tracking-wider shrink-0">
                      {t.common.active}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[var(--border-loft)]">
                    <span className="text-xs text-[var(--text-loft-secondary)] flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#34c759]" />
                      <span>
                        {resolvedRoom.allow_guests
                          ? t.lobby.guestInstantPass
                          : t.lobby.authenticatedAccess}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        router.push(
                          `/join/${encodeURIComponent(resolvedRoom.slug)}`,
                        )
                      }
                      type="button"
                      className="btn-press px-3 py-1 rounded-lg bg-[#0066CC] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                      {t.common.continue}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <div
                role="alert"
                className="px-3 py-2 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20 text-[#FF3B30] text-xs"
              >
                {tr(error)}
              </div>
            )}

            {/* ----------------- AUTHENTICATION STATE BRANCH ----------------- */}
            {isAuthLoading ? (
              /* Anti-Flicker Neutral Loading Placeholder */
              <div className="w-full flex flex-col gap-3 py-1">
                <div className="w-full h-12 rounded-xl bg-[var(--border-loft)] animate-pulse" />
              </div>
            ) : isAuthenticated ? (
              /* AUTHENTICATED STATE: Join Room + Create Room (No Google button, No empty gap) */
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-center gap-2.5">
                  <button
                    id="joinActionBtn"
                    type="button"
                    disabled={isConnecting}
                    onClick={() => void handleJoin()}
                    className="btn-press flex-1 w-full h-12 rounded-xl bg-[#0066CC] hover:bg-[#0077ED] active:scale-[0.99] text-white text-sm font-semibold tracking-tight flex items-center justify-center gap-2 transition-all shadow-md shadow-[#0066CC]/25 cursor-pointer disabled:opacity-75"
                  >
                    {isConnecting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>{t.lobby.connecting}</span>
                      </>
                    ) : (
                      <>
                        <span>{t.lobby.joinRoom}</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/home?create=1")}
                    className="btn-press w-full sm:w-auto h-12 px-5 rounded-xl bg-[var(--bg-loft-surface)] hover:bg-[var(--border-loft)] border border-[var(--border-loft)] text-[var(--text-loft-primary)] text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.99] shadow-xs cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-[#0066CC]" />
                    <span>{t.lobby.createRoom}</span>
                  </button>
                </div>

                {/* Optional Recent Rooms Section (Only if real backend data exists) */}
                {isAuthenticated && recentRooms.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-loft)] w-full text-left">
                    <span className="text-[11px] font-semibold text-[var(--text-loft-muted)] uppercase tracking-wider block mb-2 px-1">
                      {t.lobby.recentRooms}
                    </span>
                    <div className="flex flex-col gap-1">
                      {recentRooms.slice(0, 4).map((room) => (
                        <div key={room.id} className="group flex items-center gap-1 rounded-xl hover:bg-[var(--border-loft)] transition-colors text-xs">
                          <Link href={`/room/${room.id}`} className="flex-1 min-w-0 flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#0066CC]" />
                            <span className="font-medium text-[var(--text-loft-primary)] truncate">
                              {room.name}
                            </span>
                            <span className="text-[10px] text-[var(--text-loft-muted)] font-normal truncate">
                              {room.allow_guests
                                ? t.lobby.guestAccessEnabled
                                : t.lobby.signInRequired}
                            </span>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-[var(--text-loft-muted)] group-hover:text-[#0066CC] group-hover:translate-x-0.5 transition-all shrink-0" />
                          </Link>
                          <button type="button" onClick={() => { setDeleteError(null); setDeletingRoom(room); }} title={locale === "vi" ? "Xóa phòng" : "Delete room"} aria-label={`${locale === "vi" ? "Xóa phòng" : "Delete room"} ${room.name}`} className="w-8 h-8 mr-1 shrink-0 rounded-lg flex items-center justify-center text-[var(--text-loft-muted)] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 focus-visible:outline-2 focus-visible:outline-[#FF3B30]"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* LOGGED OUT STATE: Join Room + or + Continue with Google */
              <div className="flex flex-col gap-3">
                {/* Primary Submit Button */}
                <button
                  id="joinActionBtn"
                  type="button"
                  disabled={isConnecting}
                  onClick={() => void handleJoin()}
                  className="btn-press w-full h-12 rounded-xl bg-[#0066CC] hover:bg-[#0077ED] active:scale-[0.99] text-white text-sm font-semibold tracking-tight flex items-center justify-center gap-2 transition-all shadow-md shadow-[#0066CC]/25 cursor-pointer disabled:opacity-75"
                >
                  {isConnecting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{t.lobby.connecting}</span>
                    </>
                  ) : (
                    <>
                      <span>{t.lobby.joinRoom}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Divider with Ambient Line */}
                <div className="relative my-0.5 flex items-center justify-center">
                  <div className="w-full h-px bg-[var(--border-loft)]" />
                  <span className="absolute px-3 bg-[var(--bg-loft-base)] text-[var(--text-loft-muted)] text-[11px] font-semibold uppercase tracking-wider">
                    {t.common.or}
                  </span>
                </div>

                {/* Official Google Sign-In Action */}
                <button
                  onClick={() => void signInWithGoogle("/home")}
                  type="button"
                  className="btn-press w-full h-11 px-4 rounded-xl bg-[var(--bg-loft-surface)] hover:bg-[var(--border-loft)] text-[var(--text-loft-primary)] text-sm font-medium flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] border border-[var(--border-loft)] shadow-xs cursor-pointer group"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span className="group-hover:text-[#0066CC] transition-colors">
                    {t.lobby.continueWithGoogle}
                  </span>
                </button>

                <p className="text-center text-xs text-[var(--text-loft-muted)] pt-0.5">
                  {t.lobby.authHelper}
                </p>

                {/* Create Room Direct Prompt Link */}
                <div className="mt-2 text-center">
                  <button
                    onClick={handleCreateRoomAction}
                    type="button"
                    className="btn-press text-xs sm:text-sm text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{t.lobby.wantYourOwnSpace}</span>
                    <span className="text-[#0066CC] font-semibold hover:underline underline-offset-4">
                      {t.lobby.createRoom}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Spatial Ambient Bar Footer Notice */}
        <div className="relative z-10 py-2 flex flex-wrap items-center justify-center gap-6 text-[var(--text-loft-muted)] text-xs select-none">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0066CC]" />
            {t.lobby.featureWebRTC}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
            {t.lobby.featureSessions}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2193fb]" />
            {t.lobby.featureNoInstall}
          </span>
        </div>
      </main>

      <DeleteRoomDialog room={deletingRoom} locale={locale} pending={deleting} error={deleteError} onCancel={() => { setDeletingRoom(null); setDeleteError(null); }} onConfirm={() => void removeRecentRoom()} />

      {/* Subtle Spatial Footer */}
      <footer className="w-full bg-[var(--bg-loft-base)]/90 backdrop-blur-md py-2.5 border-t border-[var(--border-loft)]">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between text-[var(--text-loft-muted)] text-[11px] gap-1">
          <span>{t.lobby.footerText}</span>
          <span>{t.lobby.footerVersion}</span>
        </div>
      </footer>
    </div>
  );
}
