"use client";

import { create } from "zustand";
import { useEffect } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, signInWithGoogle as startGoogleSignIn } from "@/lib/supabase/client";
import { safeAuthDestination } from "@/lib/authRedirect";
import { api } from "@/lib/api";
import type { ApiIdentity } from "@/types/api";

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | {
      status: "authenticated";
      user: User;
      session: Session;
      identity: ApiIdentity | null;
    };

interface AuthStore {
  authState: AuthState;
  initialized: boolean;
  setAuthState: (state: AuthState) => void;
  initializeAuth: () => () => void;
  signOut: () => Promise<void>;
  signInWithGoogle: (next?: string) => Promise<void>;
}

function resumePendingAuthDestination() {
  if (typeof window === "undefined") return;
  // If we are currently on an auth callback route, let the callback page manage completion
  if (window.location.pathname.startsWith("/auth/")) return;

  const storedNext = window.sessionStorage.getItem("loft.auth.next");
  if (!storedNext) return;

  const destination = safeAuthDestination(storedNext, "/");
  const current = `${window.location.pathname}${window.location.search}`;
  window.sessionStorage.removeItem("loft.auth.next");

  if (destination !== current) {
    window.location.replace(destination);
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  authState: { status: "loading" },
  initialized: false,

  setAuthState: (authState) => set({ authState }),

  initializeAuth: () => {
    const supabase = getSupabase();
    if (!supabase) {
      set({ authState: { status: "anonymous" }, initialized: true });
      return () => {};
    }

    let isSubscribed = true;

    // 1. Initial Session Resolution
    void supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!isSubscribed) return;
      if (error || !session) {
        set({ authState: { status: "anonymous" }, initialized: true });
        return;
      }

      let identity: ApiIdentity | null = null;
      try {
        identity = await api.me(session.access_token);
      } catch {
        // Fallback gracefully to Supabase user metadata
      }

      if (isSubscribed) {
        resumePendingAuthDestination();
        set({
          authState: {
            status: "authenticated",
            user: session.user,
            session,
            identity,
          },
          initialized: true,
        });
      }
    });

    // 2. Auth State Change Listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isSubscribed) return;

      if (event === "SIGNED_OUT" || !session) {
        set({ authState: { status: "anonymous" } });
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        let identity: ApiIdentity | null = null;
        try {
          identity = await api.me(session.access_token);
        } catch {
          // Keep usable even if custom identity fails
        }

        if (isSubscribed) {
          resumePendingAuthDestination();
          set({
            authState: {
              status: "authenticated",
              user: session.user,
              session,
              identity,
            },
          });
        }
      }
    });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  },

  signOut: async () => {
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Continue clearing local state
      }
    }
    set({ authState: { status: "anonymous" } });
  },

  signInWithGoogle: async (next?: string) => {
    const destination =
      next !== undefined
        ? safeAuthDestination(next, "/")
        : typeof window !== "undefined"
          ? safeAuthDestination(
              `${window.location.pathname}${window.location.search}`,
              "/",
            )
          : "/";
    await startGoogleSignIn(destination);
  },
}));

export function useAuth() {
  const { authState, initializeAuth, signOut, signInWithGoogle } = useAuthStore();

  useEffect(() => {
    const cleanup = initializeAuth();
    return cleanup;
  }, [initializeAuth]);

  return {
    authState,
    isLoading: authState.status === "loading",
    isAuthenticated: authState.status === "authenticated",
    isAnonymous: authState.status === "anonymous",
    user: authState.status === "authenticated" ? authState.user : null,
    session: authState.status === "authenticated" ? authState.session : null,
    identity: authState.status === "authenticated" ? authState.identity : null,
    signOut,
    signInWithGoogle,
  };
}
