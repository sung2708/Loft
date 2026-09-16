"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { useTranslation } from "@/lib/i18n/useTranslation";

type LegalSection = {
  title: string;
  paragraphs: string[];
};

type LegalCopy = {
  title: string;
  summary: string;
  backLabel: string;
  updatedLabel: string;
  sections: LegalSection[];
};

export type LegalPageCopies = Record<"vi" | "en", LegalCopy>;

export function LegalPage({ copies }: { copies: LegalPageCopies }) {
  const { locale } = useTranslation();
  const copy = copies[locale];

  return (
    <div className="min-h-screen bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)]">
      <AppHeader subtitle="" actions={<LocaleToggle />} />
      <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-24 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[11px] text-[var(--text-loft-secondary)] transition-colors hover:text-[var(--text-loft-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          {copy.backLabel}
        </Link>
        <header className="mt-8 border-b border-[var(--border-loft)] pb-8">
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{copy.title}</h1>
          <p className="mt-4 max-w-2xl text-[11px] leading-6 text-[var(--text-loft-secondary)]">{copy.summary}</p>
          <p className="mt-4 text-[11px] text-[var(--text-loft-muted)]">{copy.updatedLabel}: 16/09/2026</p>
        </header>
        <div className="divide-y divide-[var(--border-loft)]">
          {copy.sections.map((section) => (
            <section key={section.title} className="py-8">
              <h2 className="text-base font-medium tracking-tight">{section.title}</h2>
              <div className="mt-3 space-y-3 text-[11px] leading-6 text-[var(--text-loft-secondary)]">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
