"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CircleAlert } from "lucide-react";
import { API_URL } from "@/lib/config";
import { LoftMark } from "@/components/brand/LoftMark";
import { useUIText } from "@/lib/i18n/uiText";
import {
  SPOTIFY_OAUTH_CHANNEL,
  type SpotifyOAuthMessage,
} from "@/lib/spotify/oauth";

type CallbackState = "processing" | "success" | "error";

function SpotifyCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const tr = useUIText();
  const [state, setState] = useState<CallbackState>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const isPopup =
      typeof window !== "undefined" &&
      (Boolean(window.opener) || window.name === "loft_spotify_oauth");

    const broadcastAndClose = (
      status: "connected" | "failed",
      returnTo?: string,
      error?: string,
    ) => {
      const msg: SpotifyOAuthMessage = {
        type: "LOFT_SPOTIFY_AUTH_COMPLETE",
        status,
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
      if (typeof BroadcastChannel !== "undefined") {
        try {
          const ch = new BroadcastChannel(SPOTIFY_OAUTH_CHANNEL);
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

    const handleCallback = async () => {
      const code = params.get("code");
      const stateParam = params.get("state");
      const statusParam = params.get("status");
      const returnToParam = params.get("return_to");

      // 1. Direct authorization code response from Spotify
      if (code && stateParam) {
        try {
          const response = await fetch(
            `${API_URL}/api/v1/spotify/callback${window.location.search}`,
            {
              headers: { Accept: "application/json" },
            },
          );

          const data = (await response.json().catch(() => null)) as {
            status?: string;
            return_to?: string;
            error?: string;
          } | null;

          if (!active) return;

          if (response.ok && data?.status === "connected") {
            setState("success");
            if (isPopup) {
              broadcastAndClose("connected", data.return_to);
            } else {
              const dest =
                data.return_to &&
                data.return_to.startsWith("/") &&
                !data.return_to.startsWith("//")
                  ? data.return_to
                  : "/settings?spotify=connected";
              router.replace(dest);
            }
          } else {
            setState("error");
            setErrorMessage(data?.error || "Connection failed");
            if (isPopup) {
              broadcastAndClose("failed", data?.return_to, data?.error);
            } else {
              router.replace("/settings?spotify=error");
            }
          }
        } catch {
          if (!active) return;
          setState("error");
          setErrorMessage("Network error during exchange");
          if (isPopup) {
            broadcastAndClose("failed", undefined, "network_error");
          } else {
            router.replace("/settings?spotify=error");
          }
        }
        return;
      }

      // 2. Pre-exchanged status redirect (e.g. from backend 302 fallback)
      if (statusParam === "connected") {
        setState("success");
        if (isPopup) {
          broadcastAndClose("connected", returnToParam ?? undefined);
        } else {
          const dest =
            returnToParam &&
            returnToParam.startsWith("/") &&
            !returnToParam.startsWith("//")
              ? returnToParam
              : "/settings?spotify=connected";
          router.replace(dest);
        }
      } else {
        setState("error");
        setErrorMessage("Connection failed");
        if (isPopup) {
          broadcastAndClose("failed", returnToParam ?? undefined, "failed");
        } else {
          router.replace("/settings?spotify=error");
        }
      }
    };

    void handleCallback();

    return () => {
      active = false;
    };
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
                {errorMessage}
              </p>
            )}
            <button
              type="button"
              onClick={() => window.close()}
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
