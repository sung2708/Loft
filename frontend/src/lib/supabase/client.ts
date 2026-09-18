import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { safeAuthDestination } from "@/lib/authRedirect";

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client =
    url && key
      ? createClient(url, key, {
          auth: {
            persistSession: true,
            flowType: "pkce",
            // The callback page owns the one-time code exchange. Letting the
            // client auto-consume it can race the page on a full reload.
            detectSessionInUrl: false,
          },
        })
      : null;
  return client;
}

export async function signInWithGoogle(next = "/") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  sessionStorage.setItem("loft.auth.next", safeAuthDestination(next, "/"));
  const callback = `${window.location.origin}/auth/callback`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback },
  });
  if (error) throw error;
}
