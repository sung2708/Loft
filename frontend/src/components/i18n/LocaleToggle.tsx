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
      aria-pressed={locale === "vi"}
      className="btn-press inline-flex h-8 overflow-hidden rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-0.5 text-[11px] font-medium transition-colors duration-200 ease-in-out hover:bg-[#101113]/5 dark:hover:bg-[#f4f5f7]/10"
    >
      <span aria-hidden="true" className={`flex min-w-8 items-center justify-center rounded-[4px] px-1.5 transition-colors duration-200 ease-in-out ${locale === "vi" ? "bg-[var(--text-loft-primary)] text-[var(--bg-loft-base)]" : "text-[var(--text-loft-muted)]"}`}>VI</span>
      <span aria-hidden="true" className={`flex min-w-8 items-center justify-center rounded-[4px] px-1.5 transition-colors duration-200 ease-in-out ${locale === "en" ? "bg-[var(--text-loft-primary)] text-[var(--bg-loft-base)]" : "text-[var(--text-loft-muted)]"}`}>EN</span>
    </button>
  );
}
