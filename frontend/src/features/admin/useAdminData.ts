"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

export type AdminGateError = "forbidden" | "mfa";

export interface AdminSession {
  token: string;
  /** Bumped by Refresh and after every decision, to reload the visible data. */
  revision: number;
  refresh: () => void;
  /** Raised when the server refuses the whole admin area. */
  reportGate: (error: AdminGateError) => void;
  notify: (message: string) => void;
}

export const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession() {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error("useAdminSession outside AdminSessionContext");
  return session;
}

/**
 * Loads one admin resource. Stale responses are dropped, so fast filter
 * changes never show an older page. Gate errors go to the page shell.
 */
export function useAdminData<T>(
  load: (token: string) => Promise<T>,
  deps: unknown[],
) {
  const { token, revision, reportGate } = useAdminSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Yield first so state updates happen outside the effect body.
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setFailed(false);
      try {
        const value = await load(token);
        if (!active) return;
        setData(value);
        setUpdatedAt(new Date());
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && cause.code === "ADMIN_MFA_REQUIRED")
          reportGate("mfa");
        else if (cause instanceof ApiError && cause.status === 403)
          reportGate("forbidden");
        else setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // load is recreated each render; deps carry what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, revision, ...deps]);

  return { data, loading, failed, updatedAt };
}

/** Debounces a search box into the value sent to the server. */
export function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
