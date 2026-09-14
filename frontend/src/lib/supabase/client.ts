import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: true, detectSessionInUrl: true },
        })
      : null;
  return client;
}

export async function signInWithGoogle(next: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  sessionStorage.setItem("loft.auth.next", next);
  const callback = `${window.location.origin}/auth/callback`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback },
  });
  if (error) throw error;
}
