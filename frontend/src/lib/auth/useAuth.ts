"use client";

import { create } from "zustand";
import { useEffect } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  getSupabase,
  signInWithGoogle as startGoogleSignIn,
} from "@/lib/supabase/client";
import { safeAuthDestination } from "@/lib/authRedirect";
import { api, clearRoomCredentials } from "@/lib/api";
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

let authSubscription: { unsubscribe: () => void } | null = null;
let activeAuthSubscribers = 0;

export const useAuthStore = create<AuthStore>((set, get) => ({
  authState: { status: "loading" },
  initialized: false,

  setAuthState: (authState) => set({ authState }),

  initializeAuth: () => {
    activeAuthSubscribers += 1;
    if (authSubscription) {
      return () => {
        activeAuthSubscribers -= 1;
        if (activeAuthSubscribers <= 0 && authSubscription) {
          authSubscription.unsubscribe();
          authSubscription = null;
        }
      };
    }

    const supabase = getSupabase();
    if (!supabase) {
      set({ authState: { status: "anonymous" }, initialized: true });
      return () => {
        activeAuthSubscribers -= 1;
      };
    }

    // 1. Initial Session Resolution
    void supabase.auth
      .getSession()
      .then(async ({ data: { session }, error }) => {
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

        set({
          authState: {
            status: "authenticated",
            user: session.user,
            session,
            identity,
          },
          initialized: true,
        });
      });

    // 2. Auth State Change Listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("loft.auth.next");
          clearRoomCredentials();
        }
        set({ authState: { status: "anonymous" }, initialized: true });
        return;
      }

      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        let identity: ApiIdentity | null = null;
        try {
          identity = await api.me(session.access_token);
        } catch {
          // Keep usable even if custom identity fails
        }

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

    authSubscription = subscription;

    return () => {
      activeAuthSubscribers -= 1;
      if (activeAuthSubscribers <= 0 && authSubscription) {
        authSubscription.unsubscribe();
        authSubscription = null;
      }
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
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("loft.auth.next");
      clearRoomCredentials();
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
  const { authState, initializeAuth, signOut, signInWithGoogle } =
    useAuthStore();

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
