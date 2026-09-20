"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { getSupabase, signInWithGoogle } from "@/lib/supabase/client";
import { ApiError, api, saveCredential } from "@/lib/api";
import type { ApiRoomPreview } from "@/types/api";
import { EASE_ENTRANCE } from "@/lib/motion";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useUIText } from "@/lib/i18n/uiText";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Globe2,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  LogIn,
  ShieldCheck,
  UserRound,
} from "lucide-react";

const ACCESS_APPROVAL_WAIT_MS = 5 * 60 * 1000;

export default function RoomJoinPage() {
  const { locale } = useTranslation();
  const l = useCallback(
    (english: string, vietnamese: string) =>
      locale === "vi" ? vietnamese : english,
    [locale],
  );
  const tr = useUIText();
  const params = useParams();
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const roomId = String(params?.roomId || "");

  const [isJoiningGuest, setIsJoiningGuest] = useState(false);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [accessRequested, setAccessRequested] = useState(false);
  const [joinStep, setJoinStep] = useState<"idle" | "connecting" | "entering">(
    "idle",
  );
  const [room, setRoom] = useState<ApiRoomPreview | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);

  const userFacingError = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof ApiError) {
      const messages: Record<string, string> = {
        AUTHENTICATION_REQUIRED: "Authentication required",
        INVALID_DISPLAY_NAME: "Display name must be 2–48 characters",
        INVALID_ROOM_PASSWORD: "That password doesn't look right. Try again.",
        RATE_LIMITED: "Please wait a moment before trying again",
        ROOM_ACCESS_DENIED: "This room does not allow guests",
        ROOM_LOCKED: "This room is locked",
        ROOM_NOT_FOUND: "Room not found",
      };
      return messages[caught.code] ?? fallback;
    }
    return fallback;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .resolveRoom(roomId, controller.signal)
      .then((resolved) => {
        setRoom(resolved.room);
        if (
          /^\d{6}$/.test(resolved.room.slug) &&
          resolved.room.slug !== roomId
        ) {
          router.replace(`/join/${encodeURIComponent(resolved.room.slug)}`);
        }
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError"))
          setError(userFacingError(caught, "Room not found"));
      });
    return () => controller.abort();
  }, [roomId, router, userFacingError]);

  useEffect(() => {
    let active = true;
    void getSupabase()
      ?.auth.getSession()
      .then(({ data }) => {
        if (active) setHasSession(Boolean(data.session));
      })
      .catch(() => {
        if (active) setHasSession(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Auto-admit authenticated users if access is already granted and no password/lock is required
  useEffect(() => {
    if (!room || !hasSession || room.password_required || room.is_locked) return;
    let active = true;
    void (async () => {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!active || !session) return;
      try {
        const result = await api.requestRoomAccess(
          session.access_token,
          room.id,
        );
        if (
          result.status === "approved" ||
          result.status === "not_required"
        ) {
          const me = await api.me(session.access_token);
          if (!active) return;
          saveCredential(room.id, {
            token: session.access_token,
            type: "user",
            roomId: room.id,
            displayName: me.display_name,
          });
          router.replace(`/room/${encodeURIComponent(room.slug)}`);
        }
      } catch {
        /* User can still interact manually if auto-admission fails */
      }
    })();
    return () => {
      active = false;
    };
  }, [room, hasSession, router]);

  // Keep the waiting page live after a host approves the request. The same
  // endpoint is idempotent and reports `approved` once membership is created.
  useEffect(() => {
    if (!accessRequested || !room || !hasSession) return;
    let active = true;
    let inFlight = false;
    let timer: number | undefined;
    const deadline = Date.now() + ACCESS_APPROVAL_WAIT_MS;

    const stopWithTimeout = () => {
      if (!active) return;
      setAccessRequested(false);
      setError(
        l(
          "Approval is taking longer than expected. Check access again.",
          "Việc phê duyệt đang mất nhiều thời gian. Hãy kiểm tra lại quyền truy cập.",
        ),
      );
    };

    const schedule = (delay: number) => {
      if (!active) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void check(), delay);
    };

    const check = async () => {
      if (!active || inFlight) return;
      if (Date.now() >= deadline) {
        stopWithTimeout();
        return;
      }
      if (document.visibilityState !== "visible") {
        schedule(10_000);
        return;
      }
      inFlight = true;
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!active) return;
      if (!session) {
        inFlight = false;
        setAccessRequested(false);
        setError(
          l(
            "Sign in again to check access.",
            "Hãy đăng nhập lại để kiểm tra quyền truy cập.",
          ),
        );
        return;
      }
      try {
        const result = await api.requestRoomAccess(
          session.access_token,
          room.id,
        );
        if (result.status === "approved" || result.status === "not_required") {
          const me = await api.me(session.access_token);
          saveCredential(room.id, {
            token: session.access_token,
            type: "user",
            roomId: room.id,
            displayName: me.display_name,
          });
          active = false;
          router.replace(`/room/${encodeURIComponent(room.slug)}`);
        }
      } catch {
        /* keep waiting; transient failures must not eject the user */
      } finally {
        inFlight = false;
        if (active) schedule(2_000);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !active) return;
      if (timer) window.clearTimeout(timer);
      void check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void check();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [accessRequested, hasSession, l, room, router]);

  const handleJoinGuest = async () => {
    if (!room) return;
    const name = displayName.trim();
    if (name.length === 1) {
      setError(
        l(
          "Display name must be at least 2 characters, or leave it blank.",
          "Tên hiển thị phải có ít nhất 2 ký tự, hoặc để trống.",
        ),
      );
      return;
    }
    setIsJoiningGuest(true);
    setJoinStep("connecting");
    setError(null);
    try {
      const guest = await api.createGuest(
        room.id,
        name || l("Guest", "Khách"),
        password,
      );
      saveCredential(room.id, {
        token: guest.token,
        type: "guest",
        roomId: guest.room_id,
        displayName: guest.display_name,
      });
      setJoinStep("entering");
      router.replace(`/room/${encodeURIComponent(room.slug)}`);
    } catch (caught) {
      setJoinStep("idle");
      setIsJoiningGuest(false);
      setError(userFacingError(caught, "Could not join room"));
    }
  };

  const handleGoogleSignIn = async () => {
    if (!room) return;
    if (hasSession) {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) return;
      if (room && !room.allow_guests) {
        setIsRequestingAccess(true);
        setError(null);
        try {
          const result = await api.requestRoomAccess(
            session.access_token,
            room.id,
          );
          if (
            result.status === "approved" ||
            result.status === "not_required"
          ) {
            const me = await api.me(session.access_token);
            saveCredential(room.id, {
              token: session.access_token,
              type: "user",
              roomId: room.id,
              displayName: me.display_name,
            });
            router.replace(`/room/${encodeURIComponent(room.slug)}`);
            return;
          }
          setAccessRequested(true);
        } catch (caught) {
          setError(userFacingError(caught, "Request failed"));
        } finally {
          setIsRequestingAccess(false);
        }
        return;
      }
      try {
        const me = await api.me(session.access_token);
        saveCredential(room.id, {
          token: session.access_token,
          type: "user",
          roomId: room.id,
          displayName: me.display_name,
        });
        router.replace(`/room/${encodeURIComponent(room.slug)}`);
      } catch (caught) {
        setError(userFacingError(caught, "Could not join room"));
      }
      return;
    }
    try {
      await signInWithGoogle(`/join/${encodeURIComponent(room.slug)}`);
    } catch (caught) {
      setError(userFacingError(caught, "Could not start Google sign-in"));
    }
  };

  if (error && !room) {
    return (
      <div className="app-canvas page-scroll min-h-dvh w-full text-[var(--text-loft-primary)]">
        <LobbyHeader />
        <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4 py-10 pt-20">
          <section className="workflow-panel w-full max-w-sm rounded-[6px] p-6 text-center">
            <CircleAlert aria-hidden="true" className="mx-auto h-5 w-5" />
            <h1 className="mt-4 text-base font-medium">
              {l("This room is unavailable", "Phòng này không khả dụng")}
            </h1>
            <p className="mt-2 text-[11px] text-[var(--text-loft-secondary)]">
              {l(
                "It may not exist or may have ended.",
                "Phòng có thể không tồn tại hoặc đã kết thúc.",
              )}
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="btn-press mt-5 inline-flex h-10 items-center gap-2 rounded-[6px] bg-[#101113] px-4 text-[11px] font-medium text-white"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {l("Back home", "Về trang chủ")}
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-canvas page-scroll min-h-dvh w-full text-[var(--text-loft-primary)] selection:bg-[#101113]/30">
      <LobbyHeader />
      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[480px] flex-col justify-center px-4 py-10 pt-20 sm:px-6">
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Globe2 aria-hidden="true" className="h-4 w-4" />
              <span className="eyebrow">{l("Room", "Phòng")}</span>
            </div>
            <div className="flex items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-2 py-1 text-[11px] font-medium">
              {room?.is_locked ? (
                <Lock aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <LockOpen aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              <span>
                {room?.is_locked
                  ? l("Locked", "Đã khóa")
                  : l("Open", "Đang mở")}
              </span>
            </div>
          </div>

          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.5,
              ease: EASE_ENTRANCE,
            }}
            className="workflow-panel overflow-hidden rounded-[6px]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-loft)] px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-loft-secondary)]">
                <UserRound aria-hidden="true" className="h-4 w-4" />
                <span>
                  {room?.allow_guests
                    ? l("Guest access", "Quyền khách")
                    : l("Account access", "Quyền tài khoản")}
                </span>
              </div>
              {room?.password_required ? (
                <KeyRound aria-hidden="true" className="h-4 w-4" />
              ) : null}
            </div>

            <div className="flex flex-col gap-3 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="break-words text-base font-medium tracking-tight">
                    {room?.name ?? l("Loading room…", "Đang tải phòng…")}
                  </h1>
                  <p className="mt-1 text-[11px] text-[var(--text-loft-secondary)]">
                    {room?.allow_guests
                      ? l(
                          "Guests can join with a display name.",
                          "Khách có thể tham gia với tên hiển thị.",
                        )
                      : l(
                          "Sign in to request access.",
                          "Đăng nhập để yêu cầu tham gia.",
                        )}
                  </p>
                </div>
                <span className="shrink-0 rounded-[6px] border border-[var(--border-loft)] px-2 py-1 text-[11px] font-medium">
                  {room?.allow_guests
                    ? l("Guests", "Khách")
                    : l("Members", "Thành viên")}
                </span>
              </div>
              {room?.is_locked ? (
                <div className="flex items-start gap-2 border-t border-[var(--border-loft)] pt-3 text-[11px] text-[var(--text-loft-secondary)]">
                  <Lock
                    aria-hidden="true"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                  <p>
                    {l(
                      "This room is locked. Ask the host to open it.",
                      "Phòng đang khóa. Hãy nhờ chủ phòng mở khóa.",
                    )}
                  </p>
                </div>
              ) : null}
            </div>

            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (room?.allow_guests) void handleJoinGuest();
              }}
              className="flex flex-col gap-3 border-t border-[var(--border-loft)] px-4 pb-4 pt-4 sm:px-5 sm:pb-5"
            >
              {room?.allow_guests ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="guest-display-name"
                    className="text-[11px] font-medium"
                  >
                    {l("Guest name", "Tên khách")}
                    <span className="ml-1 text-[var(--text-loft-muted)]">
                      {l("(optional)", "(không bắt buộc)")}
                    </span>
                  </label>
                  <input
                    id="guest-display-name"
                    value={displayName}
                    maxLength={48}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={l("Display name", "Tên hiển thị")}
                    className="h-11 w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[11px] outline-none placeholder:text-[var(--text-loft-muted)] focus:ring-2 focus:ring-[var(--accent-blue)]"
                  />
                </div>
              ) : null}
              {room?.password_required ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="room-password"
                    className="text-[11px] font-medium"
                  >
                    {l("Room password", "Mật khẩu phòng")}
                  </label>
                  <input
                    id="room-password"
                    type="password"
                    value={password}
                    maxLength={256}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-11 w-full rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 text-[11px] outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  />
                </div>
              ) : null}
              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[11px]"
                >
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <p>{tr(error)}</p>
                </div>
              ) : null}
              {accessRequested ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 text-[11px] text-[var(--text-loft-secondary)]"
                >
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <p>
                    {l(
                      "Your request was sent. We'll take you in when it is approved.",
                      "Yêu cầu đã được gửi. Bạn sẽ vào phòng khi được duyệt.",
                    )}
                  </p>
                </div>
              ) : null}
              {room?.allow_guests ? (
                <button
                  id="guest-join-btn"
                  type="submit"
                  disabled={isJoiningGuest}
                  className={`btn-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-[6px] px-4 text-[11px] font-medium disabled:cursor-wait disabled:opacity-50 ${
                    hasSession
                      ? "hover-invert border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] text-[var(--text-loft-primary)]"
                      : "bg-[#101113] text-white"
                  }`}
                >
                  {joinStep === "connecting" ? (
                    <>
                      <Loader2
                        aria-hidden="true"
                        className="h-4 w-4 motion-safe:animate-spin"
                      />
                      <span>{l("Joining…", "Đang tham gia…")}</span>
                    </>
                  ) : joinStep === "entering" ? (
                    <>
                      <Check aria-hidden="true" className="h-4 w-4" />
                      <span>{l("Joining…", "Đang tham gia…")}</span>
                    </>
                  ) : (
                    <>
                      <LogIn aria-hidden="true" className="h-4 w-4" />
                      <span>
                        {hasSession
                          ? l("Join as guest", "Tham gia với tư cách khách")
                          : l("Join", "Tham gia")}
                      </span>
                    </>
                  )}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!room || isRequestingAccess}
                onClick={() => void handleGoogleSignIn()}
                className={`btn-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-[6px] px-4 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  hasSession || !room?.allow_guests
                    ? "bg-[#101113] text-white"
                    : "hover-invert border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] text-[var(--text-loft-primary)]"
                }`}
              >
                {isRequestingAccess ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 motion-safe:animate-spin"
                  />
                ) : (
                  <LogIn aria-hidden="true" className="h-4 w-4" />
                )}
                <span>
                  {isRequestingAccess
                    ? l("Requesting…", "Đang yêu cầu…")
                    : hasSession
                      ? room?.allow_guests
                        ? l("Join", "Tham gia")
                        : accessRequested
                          ? l("Check access", "Kiểm tra quyền")
                          : l("Request access", "Yêu cầu tham gia")
                      : l("Sign in", "Đăng nhập")}
                </span>
              </button>
            </form>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
