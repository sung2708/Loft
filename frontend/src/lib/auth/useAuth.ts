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
  initializeAuth: () => () => void;
  signOut: () => Promise<void>;
  signInWithGoogle: (next?: string) => Promise<void>;
}

let authSubscription: { unsubscribe: () => void } | null = null;
let activeAuthSubscribers = 0;
let authRevision = 0;
let removePageShowListener: (() => void) | null = null;

function releaseAuthSubscriber() {
  activeAuthSubscribers -= 1;
  if (activeAuthSubscribers === 0) {
    authSubscription?.unsubscribe();
    authSubscription = null;
    removePageShowListener?.();
    removePageShowListener = null;
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  authState: { status: "loading" },

  initializeAuth: () => {
    activeAuthSubscribers += 1;
    if (authSubscription) {
      return releaseAuthSubscriber;
    }

    const supabase = getSupabase();
    if (!supabase) {
      set({ authState: { status: "anonymous" } });
      return releaseAuthSubscriber;
    }

    const resolveSession = async (session: Session | null, revision: number) => {
      if (revision !== authRevision) return;
      if (!session) {
        set({ authState: { status: "anonymous" } });
        return;
      }

      let identity: ApiIdentity | null = null;
      try {
        identity = await api.me(session.access_token);
      } catch {
        // Keep the Supabase session usable if custom identity fails.
      }

      if (revision !== authRevision) return;
      set({
        authState: {
          status: "authenticated",
          user: session.user,
          session,
          identity,
        },
      });
    };

    // 1. Initial Session Resolution
    const initialRevision = ++authRevision;
    void supabase.auth
      .getSession()
      .then(({ data: { session }, error }) =>
        resolveSession(error ? null : session, initialRevision),
      )
      .catch(() => resolveSession(null, initialRevision));

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // Back/Forward Cache restores the pre-login JS state without remounting React.
      const revision = ++authRevision;
      set({ authState: { status: "loading" } });
      void supabase.auth.getSession()
        .then(({ data: { session }, error }) =>
          resolveSession(error ? null : session, revision),
        )
        .catch(() => resolveSession(null, revision));
    };
    window.addEventListener("pageshow", onPageShow);
    removePageShowListener = () => window.removeEventListener("pageshow", onPageShow);

    // 2. Auth State Change Listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        authRevision += 1;
        if (event === "SIGNED_OUT" && typeof window !== "undefined") {
          window.sessionStorage.removeItem("loft.auth.next");
          clearRoomCredentials();
        }
        set({ authState: { status: "anonymous" } });
        return;
      }

      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        const revision = ++authRevision;
        await resolveSession(session, revision);
      }
    });

    authSubscription = subscription;

    return releaseAuthSubscriber;
  },

  signOut: async () => {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
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
