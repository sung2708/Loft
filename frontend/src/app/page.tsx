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
  Terminal,
  ArrowRight,
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
    <div className="min-h-screen w-full flex flex-col bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)] relative overflow-x-hidden selection:bg-[#101113]/30">
      {/* Top Shared Lobby Header */}
      <LobbyHeader />

      {/* Main Spatial Stage Body */}
      <main className="flex-1 w-full pt-12 min-h-[calc(100vh-3rem)] flex flex-col items-center justify-between px-4 sm:px-6 py-8 relative">
        {/* Ambient Lounge Glows */}
        <div
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[360px] bg-gradient-to-b from-[#101113]/20 via-[#101113]/10 to-transparent rounded-full blur-3xl -z-10 animate-pulse"
          style={{ animationDuration: "1150ms" }}
        />
        <div className="pointer-events-none absolute top-1/3 -left-48 w-80 h-80 bg-[#101113]/10 rounded-full blur-[100px] -z-10" />
        <div
          className="pointer-events-none absolute bottom-16 -right-32 w-96 h-96 bg-[#101113]/10 rounded-full blur-[120px] -z-10 animate-pulse"
          style={{ animationDuration: "1150ms" }}
        />

        {/* Central Spatial Anchor Enclosure */}
        <div className="relative w-full max-w-[480px] my-auto py-6 flex flex-col items-center text-center z-10">
          {/* Standalone brand mark */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
            className="relative mb-5"
          >
            <LoftMark className="w-16 h-16 text-[var(--brand-mark)]" />
          </motion.div>

          {/* Typography */}
          <motion.h1
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05, ease: EASE_ENTRANCE }}
            className="text-3xl font-medium leading-tight tracking-tight text-[var(--text-loft-primary)] text-balance"
          >
            {t.lobby.heroTitle}
          </motion.h1>
          {/* Main Interaction Form Surface */}
          <div className="w-full mt-6 flex flex-col gap-4 text-left">
            {/* Input Enclosure */}
            <div className="relative w-full group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-loft-muted)] group-focus-within:text-[var(--text-loft-primary)] transition-colors flex items-center pointer-events-none">
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
                className="room-code-input w-full h-12 pl-10 pr-12 rounded-[6px] bg-[var(--bg-loft-surface)] text-[var(--text-loft-primary)] placeholder:text-[var(--text-loft-muted)] font-medium text-[11px] outline-none border border-[var(--border-loft)] focus:border-[var(--border-loft)] focus:ring-2 focus:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs"
              />
            </div>

            {/* Backend-resolved room preview */}
            <AnimatePresence>
              {resolvedRoom && (
                <motion.div
                  id="roomPreviewCard"
                  initial={{ opacity: 0, height: 0, scale: 0.96 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: EASE_SPATIAL }}
                  className="flex flex-col gap-3 p-4 rounded-[6px] bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-lg transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative flex items-center justify-center w-8 h-8 rounded-[6px] bg-[#101113]/15 text-[var(--text-loft-primary)] shrink-0">
                        <Terminal className="w-4 h-4" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#101113] animate-ping" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#101113]" />
                      </div>
                      <div className="flex flex-col text-left min-w-0">
                        <span className="text-[11px] font-medium text-[var(--text-loft-primary)] truncate">
                          {resolvedRoom.name}
                        </span>
                        <span className="text-[11px] text-[var(--text-loft-secondary)] truncate">
                          {resolvedRoom.allow_guests
                            ? t.lobby.guestAccessEnabled
                            : t.lobby.signInRequired}
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded-full bg-[#101113]/15 text-[var(--text-loft-primary)] text-[11px] font-medium uppercase tracking-wider shrink-0">
                      {t.common.active}
                    </span>
                  </div>

                  <div className="flex items-center justify-end pt-1 border-t border-[var(--border-loft)]">
                    <button
                      onClick={() =>
                        router.push(
                          `/join/${encodeURIComponent(resolvedRoom.slug)}`,
                        )
                      }
                      type="button"
                      className="btn-press px-3 py-1 rounded-[6px] bg-[#101113] hover:bg-[#101113] text-white text-[11px] font-medium shadow-xs transition-all cursor-pointer"
                    >
                      {t.common.join}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <div
                role="alert"
                className="px-3 py-2 rounded-[6px] bg-[#101113]/10 border border-[var(--border-loft)]/20 text-[var(--text-loft-primary)] text-[11px]"
              >
                {tr(error)}
              </div>
            )}

            {/* ----------------- AUTHENTICATION STATE BRANCH ----------------- */}
            {isAuthLoading ? (
              /* Anti-Flicker Neutral Loading Placeholder */
              <div className="w-full flex flex-col gap-3 py-1">
                <div className="w-full h-12 rounded-[6px] bg-[var(--border-loft)] animate-pulse" />
              </div>
            ) : isAuthenticated ? (
              /* AUTHENTICATED STATE: Join Room + Create Room (No Google button, No empty gap) */
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    id="joinActionBtn"
                    type="button"
                    disabled={isConnecting}
                    onClick={() => void handleJoin()}
                    className="btn-press flex-1 w-full h-12 rounded-[6px] bg-[#101113] hover:bg-[#101113] active:scale-[0.99] text-white text-[11px] font-medium tracking-tight flex items-center justify-center gap-2 transition-all shadow-md shadow-[#101113]/25 cursor-pointer disabled:opacity-75"
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
                    className="btn-press w-full sm:w-auto h-12 px-5 rounded-[6px] bg-[var(--bg-loft-surface)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] border border-[var(--border-loft)] text-[var(--text-loft-primary)] text-[11px] font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.99] shadow-xs cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-[var(--text-loft-primary)]" />
                    <span>{t.lobby.createRoom}</span>
                  </button>
                </div>

                {/* Optional Recent Rooms Section (Only if real backend data exists) */}
                {isAuthenticated && recentRooms.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-loft)] w-full text-left">
                    <span className="text-[11px] font-medium text-[var(--text-loft-muted)] uppercase tracking-wider block mb-2 px-1">
                      {t.lobby.recentRooms}
                    </span>
                    <div className="flex flex-col gap-1">
                      {recentRooms.slice(0, 4).map((room) => (
                        <div key={room.id} className="group flex items-center gap-1 rounded-[6px] text-[11px]">
                          <Link href={`/room/${room.slug}`} className="flex-1 min-w-0 flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-[var(--text-loft-primary)]" />
                            <span className="font-medium text-[var(--text-loft-primary)] truncate">
                              {room.name}
                            </span>
                            <span className="text-[11px] text-[var(--text-loft-muted)] font-medium truncate">
                              {room.allow_guests
                                ? t.lobby.guestAccessEnabled
                                : t.lobby.signInRequired}
                            </span>
                            </div>
                            <ArrowRight className="w-4 h-4 text-[var(--text-loft-muted)] group-hover:translate-x-1 transition-transform shrink-0" />
                          </Link>
                          <button type="button" onClick={() => { setDeleteError(null); setDeletingRoom(room); }} title={locale === "vi" ? "Xóa phòng" : "Delete room"} aria-label={`${locale === "vi" ? "Xóa phòng" : "Delete room"} ${room.name}`} className="w-8 h-8 mr-1 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-loft-muted)] hover:text-[var(--text-loft-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)] transition-colors"><Trash2 className="w-4 h-4" /></button>
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
                  className="btn-press w-full h-12 rounded-[6px] bg-[#101113] hover:bg-[#101113] active:scale-[0.99] text-white text-[11px] font-medium tracking-tight flex items-center justify-center gap-2 transition-all shadow-md shadow-[#101113]/25 cursor-pointer disabled:opacity-75"
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
                <div className="relative my-1 flex items-center justify-center">
                  <div className="w-full h-px bg-[var(--border-loft)]" />
                  <span className="absolute px-3 bg-[var(--bg-loft-base)] text-[var(--text-loft-muted)] text-[11px] font-medium uppercase tracking-wider">
                    {t.common.or}
                  </span>
                </div>

                {/* Official Google Sign-In Action */}
                <button
                  onClick={() => void signInWithGoogle("/home")}
                  type="button"
                  className="btn-press w-full h-11 px-4 rounded-[6px] bg-[var(--bg-loft-surface)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] text-[var(--text-loft-primary)] text-[11px] font-medium flex items-center justify-center gap-3 transition-all active:scale-[0.99] border border-[var(--border-loft)] shadow-xs cursor-pointer group"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="currentColor"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="currentColor"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      fill="currentColor"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="group-hover:text-[var(--text-loft-primary)] transition-colors">
                    {t.lobby.continueWithGoogle}
                  </span>
                </button>

                <div className="mt-1 text-center">
                  <button
                    onClick={handleCreateRoomAction}
                    type="button"
                    className="btn-press text-[11px] text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <span className="text-[var(--text-loft-primary)] font-medium hover:underline underline-offset-4">
                      {t.lobby.createRoom}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </main>

      <DeleteRoomDialog room={deletingRoom} locale={locale} pending={deleting} error={deleteError} onCancel={() => { setDeletingRoom(null); setDeleteError(null); }} onConfirm={() => void removeRecentRoom()} />

    </div>
  );
}
