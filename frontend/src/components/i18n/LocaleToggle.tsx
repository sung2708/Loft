"use client";

import { useTranslation } from "@/lib/i18n/useTranslation";

export function LocaleToggle() {
  const { locale, toggleLocale } = useTranslation();

  return (
    <button
      type="button"
      onClick={toggleLocale}
      title={locale === "vi" ? "Chuyển sang English" : "Chuyển sang Tiếng Việt"}
      aria-label={locale === "vi" ? "Ngôn ngữ hiện tại: Tiếng Việt. Chuyển sang English" : "Current language: English. Switch to Vietnamese"}
      className="btn-press inline-flex h-8 overflow-hidden rounded-[7px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-0.5 text-[11px] font-medium"
    >
      <span className={`flex min-w-8 items-center justify-center rounded-[4px] px-1.5 transition-colors ${locale === "vi" ? "bg-[var(--text-loft-primary)] text-[var(--bg-loft-base)]" : "text-[var(--text-loft-muted)]"}`}>VI</span>
      <span className={`flex min-w-8 items-center justify-center rounded-[4px] px-1.5 transition-colors ${locale === "en" ? "bg-[var(--text-loft-primary)] text-[var(--bg-loft-base)]" : "text-[var(--text-loft-muted)]"}`}>EN</span>
    </button>
  );
}
