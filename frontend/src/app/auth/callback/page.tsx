"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { safeAuthDestination } from "@/lib/authRedirect";
import { useUIText } from "@/lib/i18n/uiText";

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
          setError(result.error.message);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError("Google sign-in did not return a session");
        return;
      }
      location.replace(
        safeAuthDestination(sessionStorage.getItem("loft.auth.next")),
      );
    })();
  }, []);
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-card rounded-3xl p-8 text-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#0066CC]/20 border-t-[#0066CC] animate-spin mx-auto" />
        <h1 className="mt-4 font-semibold">{tr("Finishing Google sign-in…")}</h1>
        {error && (
          <>
            <p className="mt-2 text-sm text-[#FF3B30]">{tr(error)}</p>
            <a href="/" className="inline-block mt-4 text-sm text-[#0066CC]">
              {tr("Return home")}
            </a>
          </>
        )}
      </div>
    </main>
  );
}
