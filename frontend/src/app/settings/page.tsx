"use client";

import Link from "next/link";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { useUIStore } from "@/stores/useUIStore";
import { ArrowLeft } from "lucide-react";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { useAuth } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";

export default function SettingsPage() {
  const { isAuthenticated, isLoading, session, signInWithGoogle } = useAuth();
  const { locale } = useTranslation();
  const isVietnamese = locale === "vi";
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  return (
    <main className="app-canvas page-scroll min-h-dvh text-[var(--text-loft-primary)]">
      <LobbyHeader />
      <div aria-hidden="true" className="h-14" />
      <section className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
        <Link href="/home" className="btn-press hover-invert inline-flex h-8 w-fit items-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[13px]">
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {isVietnamese ? "Phòng của bạn" : "Your rooms"}
        </Link>
        <div className="mt-10">
          <p className="eyebrow">{isVietnamese ? "Tài khoản" : "Account"}</p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.05em]">
            {isVietnamese ? "Cài đặt" : "Settings"}
          </h1>
        </div>
        <section className="workflow-panel mt-10 rounded-[10px] p-5 sm:p-6">
          {isLoading ? (
            <p className="text-[13px] text-[var(--text-loft-secondary)]">{isVietnamese ? "Đang tải…" : "Loading…"}</p>
          ) : isAuthenticated && session ? (
            <div className="space-y-2 text-[13px]">
              <p className="font-medium">{isVietnamese ? "Đã đăng nhập" : "Signed in"}</p>
              <p className="text-[var(--text-loft-secondary)]">{session.user.email ?? (isVietnamese ? "Tài khoản của bạn" : "Your account")}</p>
            </div>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle("/settings")} className="btn-press h-10 rounded-[10px] bg-[#101113] px-4 text-[13px] font-medium text-white">
              {isVietnamese ? "Đăng nhập" : "Sign in"}
            </button>
          )}
        </section>
        <section aria-labelledby="preferences-title" className="utility-panel mt-6 overflow-hidden">
          <h2 id="preferences-title" className="border-b border-[var(--border-loft)] px-5 py-4 text-base font-medium">{isVietnamese ? "Tùy chọn" : "Preferences"}</h2>
          <div className="flex items-center justify-between gap-4 border-b border-[var(--border-loft)] p-5">
            <label htmlFor="account-theme" className="text-sm">{isVietnamese ? "Giao diện" : "Appearance"}</label>
            <select id="account-theme" value={theme} onChange={(event) => {
              const next = event.target.value;
              if (next === "system" || next === "light" || next === "dark") setTheme(next);
            }} className="min-h-11 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-sm">
              <option value="system">{isVietnamese ? "Hệ thống" : "System"}</option>
              <option value="light">{isVietnamese ? "Sáng" : "Light"}</option>
              <option value="dark">{isVietnamese ? "Tối" : "Dark"}</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 p-5">
            <span className="text-sm">{isVietnamese ? "Ngôn ngữ" : "Language"}</span>
            <LocaleToggle />
          </div>
        </section>
      </section>
    </main>
  );
}
