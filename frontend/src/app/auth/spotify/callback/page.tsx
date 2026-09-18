"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CircleAlert } from "lucide-react";
import { LoftMark } from "@/components/brand/LoftMark";
import { useUIText } from "@/lib/i18n/uiText";
import { safeAuthDestination } from "@/lib/authRedirect";
import {
  SPOTIFY_OAUTH_CHANNEL,
  SPOTIFY_OAUTH_ATTEMPT_KEY,
  SPOTIFY_RETURN_TO_KEY,
  type SpotifyOAuthMessage,
} from "@/lib/spotify/oauth";

type CallbackState = "processing" | "success" | "error";

function SpotifyCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const tr = useUIText();
  const [state, setState] = useState<CallbackState>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const executedRef = useRef(false);
  const returnToRef = useRef("/settings");
  const attemptIdRef = useRef("");
  const isPopupRef = useRef(false);

  useEffect(() => {
    if (executedRef.current) return;
    executedRef.current = true;

    const isPopup =
      typeof window !== "undefined" &&
      (Boolean(window.opener) ||
        window.name.startsWith(`${SPOTIFY_OAUTH_CHANNEL}:`));
    isPopupRef.current = isPopup;

    const broadcastAndClose = (
      status: "connected" | "failed",
      returnTo?: string,
      error?: string,
    ) => {
      const msg: SpotifyOAuthMessage = {
        type: "LOFT_SPOTIFY_AUTH_COMPLETE",
        status,
        attemptId: attemptIdRef.current,
        returnTo,
        error,
      };

      // 1. PostMessage to opener
      if (window.opener) {
        try {
          window.opener.postMessage(msg, window.location.origin);
        } catch {
          // Cross-origin opener protection
        }
      }

      // 2. BroadcastChannel
      if (attemptIdRef.current && typeof BroadcastChannel !== "undefined") {
        try {
          const ch = new BroadcastChannel(
            `${SPOTIFY_OAUTH_CHANNEL}:${attemptIdRef.current}`,
          );
          ch.postMessage(msg);
          ch.close();
        } catch {
          // ignore
        }
      }

      // Close popup after brief acknowledgment
      if (status === "connected") {
        window.setTimeout(() => {
          try {
            window.close();
          } catch {
            // ignore
          }
        }, 600);
      }
    };

    const handleCallback = () => {
      const statusParam = params.get("status");
      const returnTo = safeAuthDestination(
        window.sessionStorage.getItem(SPOTIFY_RETURN_TO_KEY),
        "/settings",
      );
      returnToRef.current = returnTo;
      let attemptId = window.sessionStorage.getItem(
        SPOTIFY_OAUTH_ATTEMPT_KEY,
      );
      if (
        !attemptId &&
        typeof window !== "undefined" &&
        window.name.startsWith(`${SPOTIFY_OAUTH_CHANNEL}:`)
      ) {
        attemptId = window.name.slice(`${SPOTIFY_OAUTH_CHANNEL}:`.length);
      }
      if (/^[0-9a-f-]{36}$/i.test(attemptId ?? "")) {
        attemptIdRef.current = attemptId as string;
      }
      window.sessionStorage.removeItem(SPOTIFY_RETURN_TO_KEY);
      window.sessionStorage.removeItem(SPOTIFY_OAUTH_ATTEMPT_KEY);

      // The backend has already redeemed the code and persisted credentials.
      // This page receives only a safe outcome, never OAuth code or state.
      if (statusParam === "connected") {
        setState("success");
        if (isPopup) {
          broadcastAndClose("connected", returnTo);
        } else {
          router.replace(returnTo);
        }
      } else {
        const reason = params.get("reason");
        const messages: Record<string, string> = {
          oauth_denied: "Spotify connection was cancelled",
          oauth_expired: "This Spotify connection link has expired. Try again.",
          oauth_invalid: "Spotify could not verify this connection. Try again.",
          oauth_unavailable: "Spotify is temporarily unavailable. Try again.",
          credential_store_failed:
            "Could not save the Spotify connection. Try again.",
        };
        setState("error");
        setErrorMessage(messages[reason ?? ""] || "Connection failed");
        if (isPopup) {
          broadcastAndClose("failed", returnTo, reason || "failed");
        }
      }
    };

    handleCallback();
  }, [params, router]);

  return (
    <main className="app-canvas utility-page flex items-center justify-center p-4">
      <section
        aria-live="polite"
        className="utility-panel flex w-full max-w-xs flex-col items-center rounded-[6px] p-6 text-center"
      >
        <LoftMark className="h-8 w-8" />
        {state === "processing" && (
          <>
            <div className="app-loader mt-5" aria-hidden="true" />
            <p className="mt-4 text-[11px] text-[var(--text-loft-secondary)]">
              {tr("Connecting Spotify…")}
            </p>
          </>
        )}
        {state === "success" && (
          <>
            <div className="mt-5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--status-success)]/10 text-[var(--status-success)]">
              <Check className="h-4 w-4" />
            </div>
            <p className="mt-3 text-[12px] font-medium text-[var(--text-loft-primary)]">
              {tr("Connected")}
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-loft-secondary)]">
              {tr("This window will close automatically.")}
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <div className="mt-5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--status-danger)]/10 text-[var(--status-danger)]">
              <CircleAlert className="h-4 w-4" />
            </div>
            <p className="mt-3 text-[12px] font-medium text-[var(--status-danger)]">
              {tr("Connection failed")}
            </p>
            {errorMessage && (
              <p className="mt-1 text-[10px] text-[var(--text-loft-secondary)]">
                {tr(errorMessage)}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (isPopupRef.current) window.close();
                else router.replace(returnToRef.current);
              }}
              className="control-secondary mt-4 inline-flex h-7 items-center rounded-[4px] px-3 text-[10px] font-medium"
            >
              {tr("Close")}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

export default function SpotifyCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="app-canvas utility-page flex items-center justify-center p-4">
          <section
            aria-live="polite"
            className="utility-panel flex w-full max-w-xs flex-col items-center rounded-[6px] p-6 text-center"
          >
            <LoftMark className="h-8 w-8" />
            <div className="app-loader mt-5" aria-hidden="true" />
          </section>
        </main>
      }
    >
      <SpotifyCallbackContent />
    </Suspense>
  );
}
