"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Headphones,
  Link2,
  Loader2,
  Music2,
  Unlink,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { useAuth } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { startSpotifyOAuth } from "@/lib/spotify/oauth";
import { useSpotifyStore } from "@/stores/useSpotifyStore";

type ConnectionAction = "idle" | "connecting" | "disconnecting";

export default function SettingsPage() {
  const { isAuthenticated, isLoading, session, signInWithGoogle } = useAuth();
  const { locale } = useTranslation();
  const isVietnamese = locale === "vi";
  const spotifyConnection = useSpotifyStore((state) => state.connection);
  const fetchSpotifyStatus = useSpotifyStore((state) => state.fetchStatus);
  const disconnectSpotify = useSpotifyStore((state) => state.disconnect);
  const isSpotifyLoading = useSpotifyStore((state) => state.isLoading);
  const connected = spotifyConnection.status === "CONNECTED";
  const [action, setAction] = useState<ConnectionAction>("idle");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const searchParamNotice = typeof window !== "undefined" ? (() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify") === "error") {
      return isVietnamese
        ? "Không thể kết nối Spotify. Hãy thử lại."
        : "Could not connect Spotify. Try again.";
    }
    if (params.get("spotify") === "connected") {
      return isVietnamese
        ? "Đã kết nối tài khoản Spotify thành công."
        : "Spotify connected successfully.";
    }
    return null;
  })() : null;

  const notice = actionNotice ?? searchParamNotice;

  useEffect(() => {
    if (session?.access_token) {
      void fetchSpotifyStatus(session.access_token);
    }
  }, [fetchSpotifyStatus, session?.access_token]);

  const connect = async () => {
    if (!session?.access_token || action !== "idle") return;
    setAction("connecting");
    setActionNotice(null);

    try {
      const res = await startSpotifyOAuth(session.access_token, {
        returnTo: "/settings",
        onClosed: () => {
          setAction("idle");
        },
      });

      if (res.connected) {
        await fetchSpotifyStatus(session.access_token);
        setActionNotice(
          isVietnamese
            ? "Đã kết nối tài khoản Spotify thành công."
            : "Spotify connected successfully.",
        );
      } else if (res.error && res.error !== "window_closed") {
        setActionNotice(
          isVietnamese
            ? "Không thể kết nối Spotify. Hãy thử lại."
            : "Could not connect Spotify. Try again.",
        );
      }
    } catch {
      setActionNotice(
        isVietnamese
          ? "Không thể bắt đầu kết nối. Hãy kiểm tra mạng rồi thử lại."
          : "Could not start the connection. Check your connection and try again.",
      );
    } finally {
      setAction("idle");
    }
  };

  const disconnect = async () => {
    if (!session?.access_token || action !== "idle") return;
    setAction("disconnecting");
    setActionNotice(null);

    try {
      const ok = await disconnectSpotify(session.access_token);
      if (!ok) throw new Error("disconnect_failed");
    } catch {
      setActionNotice(
        isVietnamese
          ? "Không thể ngắt kết nối. Hãy thử lại."
          : "Could not disconnect Spotify. Try again.",
      );
    } finally {
      setAction("idle");
    }
  };

  return (
    <main className="app-canvas page-scroll min-h-dvh text-[var(--text-loft-primary)]">
      <LobbyHeader />
      <div aria-hidden="true" className="h-14" />

      <section className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href="/home"
          className="btn-press hover-invert inline-flex h-8 w-fit items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[11px] text-[var(--text-loft-primary)]"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {isVietnamese ? "Phòng của bạn" : "Your rooms"}
        </Link>

        <div className="mt-10">
          <p className="eyebrow">{isVietnamese ? "Tài khoản" : "Account"}</p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.05em]">
            {isVietnamese ? "Cài đặt" : "Settings"}
          </h1>
        </div>

        <section
          aria-labelledby="spotify-title"
          className="workflow-panel mt-10 overflow-hidden rounded-[6px]"
        >
          <div className="flex items-start gap-4 border-b border-[var(--border-loft)] p-5 sm:p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[#101113]/10">
              <Music2 aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="spotify-title" className="text-base font-medium tracking-tight">
                Spotify
              </h2>
              <p className="mt-1 text-[11px] text-[var(--text-loft-secondary)]">
                {isVietnamese
                  ? "Quản lý kết nối nghe nhạc của bạn."
                  : "Manage your music connection."}
              </p>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            {isLoading || isSpotifyLoading ? (
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-loft-secondary)]" aria-live="polite">
                <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
                {isVietnamese ? "Đang tải cài đặt…" : "Loading settings…"}
              </div>
            ) : !isAuthenticated ? (
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium">
                    {isVietnamese ? "Cần đăng nhập" : "Sign-in required"}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--text-loft-muted)]">
                    {isVietnamese
                      ? "Đăng nhập để quản lý kết nối."
                      : "Sign in to manage this connection."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signInWithGoogle("/settings")}
                  className="btn-press h-10 rounded-[6px] bg-[#101113] px-4 text-[11px] font-medium text-white"
                >
                  {isVietnamese ? "Đăng nhập" : "Sign in"}
                </button>
              </div>
            ) : connected ? (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]">
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium">
                      {isVietnamese ? "Đã kết nối" : "Connected"}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-loft-muted)]">
                      {isVietnamese
                        ? "Bạn có thể dùng Spotify trong các phòng hỗ trợ."
                        : "You can use Spotify in supported rooms."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={action !== "idle"}
                  onClick={() => void disconnect()}
                  className="btn-press hover-invert inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[11px] font-medium text-[var(--text-loft-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {action === "disconnecting" ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
                  ) : (
                    <Unlink aria-hidden="true" className="h-4 w-4" />
                  )}
                  {action === "disconnecting"
                    ? isVietnamese
                      ? "Đang ngắt…"
                      : "Disconnecting…"
                    : isVietnamese
                      ? "Ngắt kết nối"
                      : "Disconnect"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]">
                    <Headphones aria-hidden="true" className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium">
                      {isVietnamese ? "Chưa kết nối" : "Not connected"}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-loft-muted)]">
                      {isVietnamese
                        ? "Kết nối để dùng Spotify trong các phòng hỗ trợ."
                        : "Connect to use Spotify in supported rooms."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={action !== "idle"}
                  onClick={() => void connect()}
                  className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-[6px] bg-[#101113] px-4 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {action === "connecting" ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
                  ) : (
                    <Link2 aria-hidden="true" className="h-4 w-4" />
                  )}
                  {action === "connecting"
                    ? isVietnamese
                      ? "Đang kết nối…"
                      : "Connecting…"
                    : isVietnamese
                      ? "Kết nối"
                      : "Connect"}
                </button>
              </div>
            )}

            {notice ? (
              <div role="alert" className="mt-5 flex items-start gap-3 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[11px]">
                <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{notice}</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
