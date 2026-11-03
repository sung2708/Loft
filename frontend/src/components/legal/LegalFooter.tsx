"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/lib/i18n/useTranslation";

export function LegalFooter() {
  const pathname = usePathname();
  const { locale } = useTranslation();

  if (pathname === "/room" || pathname.startsWith("/room/")) return null;

  return (
    <footer className="app-canvas border-t border-[var(--stroke-subtle)] px-4 py-5 sm:px-6">
      <nav aria-label={locale === "vi" ? "Thông tin pháp lý" : "Legal information"} className="mx-auto flex w-full max-w-[920px] items-center justify-center gap-4 text-[14px] text-[var(--text-loft-muted)]">
        <Link href="/privacy" className="transition-colors hover:text-[var(--text-loft-primary)]">
          {locale === "vi" ? "Quyền riêng tư" : "Privacy"}
        </Link>
        <Link href="/terms" className="transition-colors hover:text-[var(--text-loft-primary)]">
          {locale === "vi" ? "Điều khoản" : "Terms"}
        </Link>
      </nav>
    </footer>
  );
}
