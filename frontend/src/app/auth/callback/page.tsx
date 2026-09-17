"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { safeAuthDestination } from "@/lib/authRedirect";
import { useUIText } from "@/lib/i18n/uiText";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import Link from "next/link";

export default function AuthCallbackPage() {
  const tr = useUIText();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const supabase = getSupabase();
      if (!supabase) {
        setError("Supabase is not configured");
        return;
      }
      const code = new URLSearchParams(location.search).get("code");
      if (code) {
        const result = await supabase.auth.exchangeCodeForSession(code);
        if (result.error) {
          setError("Google sign-in did not return a session");
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError("Google sign-in did not return a session");
        return;
      }
      const queryNext = new URLSearchParams(location.search).get("next");
      const storedNext = sessionStorage.getItem("loft.auth.next");
      const destination = safeAuthDestination(queryNext || storedNext);
      sessionStorage.removeItem("loft.auth.next");
      location.replace(destination);
    })();
  }, []);
  return (
    <main className="app-canvas min-h-screen flex items-center justify-center p-4 pt-20 sm:p-6 sm:pt-20">
      <LobbyHeader />
      <section aria-live="polite" className="utility-panel w-full max-w-sm rounded-[6px] p-6 text-center sm:p-8">
        <div className="app-loader mx-auto" aria-hidden="true" />
        <h1 className="mt-5 font-medium">{tr(error ? "Could not start Google sign-in" : "Finishing Google sign-in…")}</h1>
        {error && (
          <>
            <p className="mt-2 text-[11px] text-[var(--text-loft-primary)]">{tr(error)}</p>
            <Link href="/" className="control-secondary mt-5 inline-flex h-9 items-center rounded-[6px] px-3 text-[11px] font-medium">
              {tr("Return home")}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
