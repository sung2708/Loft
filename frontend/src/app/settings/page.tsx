"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { useAuth } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";

export default function SettingsPage() {
  const { isAuthenticated, isLoading, session, signInWithGoogle } = useAuth();
  const { locale } = useTranslation();
  const isVietnamese = locale === "vi";

  return (
    <main className="app-canvas page-scroll min-h-dvh text-[var(--text-loft-primary)]">
      <LobbyHeader />
      <div aria-hidden="true" className="h-14" />
      <section className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
        <Link href="/home" className="btn-press hover-invert inline-flex h-8 w-fit items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[11px]">
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {isVietnamese ? "Phòng của bạn" : "Your rooms"}
        </Link>
        <div className="mt-10">
          <p className="eyebrow">{isVietnamese ? "Tài khoản" : "Account"}</p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.05em]">
            {isVietnamese ? "Cài đặt" : "Settings"}
          </h1>
        </div>
        <section className="workflow-panel mt-10 rounded-[6px] p-5 sm:p-6">
          {isLoading ? (
            <p className="text-[11px] text-[var(--text-loft-secondary)]">{isVietnamese ? "Đang tải…" : "Loading…"}</p>
          ) : isAuthenticated && session ? (
            <div className="space-y-2 text-[11px]">
              <p className="font-medium">{isVietnamese ? "Đã đăng nhập" : "Signed in"}</p>
              <p className="text-[var(--text-loft-secondary)]">{session.user.email ?? (isVietnamese ? "Tài khoản của bạn" : "Your account")}</p>
            </div>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle("/settings")} className="btn-press h-10 rounded-[6px] bg-[#101113] px-4 text-[11px] font-medium text-white">
              {isVietnamese ? "Đăng nhập" : "Sign in"}
            </button>
          )}
        </section>
      </section>
    </main>
  );
}
