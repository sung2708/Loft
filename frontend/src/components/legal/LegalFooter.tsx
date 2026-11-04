"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/lib/i18n/useTranslation";

export function LegalFooter() {
  const pathname = usePathname();
  const { locale } = useTranslation();

  if (pathname === "/room" || pathname.startsWith("/room/")) return null;

  const admin = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <>
      {!admin && <div aria-hidden="true" className="h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0" />}
      <footer className={`${admin ? "relative" : "fixed inset-x-0 bottom-0 z-40"} border-t border-[var(--stroke-subtle)] bg-[var(--bg-loft-base)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6`}>
        <nav aria-label={locale === "vi" ? "Thông tin pháp lý" : "Legal information"} className="mx-auto flex w-full max-w-[920px] items-center justify-center gap-4 text-[14px] text-[var(--text-loft-muted)]">
          <Link href="/privacy" className="transition-colors hover:text-[var(--text-loft-primary)]">
            {locale === "vi" ? "Quyền riêng tư" : "Privacy"}
          </Link>
          <Link href="/terms" className="transition-colors hover:text-[var(--text-loft-primary)]">
            {locale === "vi" ? "Điều khoản" : "Terms"}
          </Link>
        </nav>
      </footer>
    </>
  );
}
