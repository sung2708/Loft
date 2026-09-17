"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/config";
import { LoftMark } from "@/components/brand/LoftMark";
import { useUIText } from "@/lib/i18n/uiText";

function SpotifyCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const tr = useUIText();

  useEffect(() => {
    // Spotify redirects to the public frontend URI. Forward the authorization
    // response to the backend, which owns the PKCE verifier and token exchange.
    if (params.get("code") && params.get("state")) {
      window.location.replace(
        `${API_URL}/api/v1/spotify/callback${window.location.search}`,
      );
      return;
    }
    const status = params.get("status");
    const returnTo = params.get("return_to");
    if (status === "connected") {
      const destination =
        returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : "/settings?spotify=connected";
      router.replace(destination);
    } else {
      router.replace("/settings?spotify=error");
    }
  }, [params, router]);

  return (
    <main className="app-canvas utility-page flex items-center justify-center p-4">
      <section
        aria-live="polite"
        className="utility-panel flex w-full max-w-xs flex-col items-center rounded-[6px] p-6 text-center"
      >
        <LoftMark className="h-8 w-8" />
        <div className="app-loader mt-5" aria-hidden="true" />
        <p className="mt-4 text-[11px] text-[var(--text-loft-secondary)]">
          {tr("Connecting Spotify…")}
        </p>
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
