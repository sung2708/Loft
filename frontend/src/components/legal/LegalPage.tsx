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
  notice?: string;
  sections: LegalSection[];
};

export type LegalPageCopies = Record<"vi" | "en", LegalCopy>;

export function LegalPage({ copies }: { copies: LegalPageCopies }) {
  const { locale } = useTranslation();
  const copy = copies[locale];

  return (
    <div className="app-canvas utility-page">
      <AppHeader subtitle="" actions={<LocaleToggle />} />
      <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-24 sm:px-8 sm:pb-16">
        <Link
          href="/"
          className="control-secondary inline-flex h-9 items-center gap-2 rounded-[6px] px-3 text-[11px] font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          {copy.backLabel}
        </Link>
        <article className="utility-panel mt-6 rounded-[6px] px-5 py-7 sm:mt-8 sm:px-8 sm:py-10">
        <header className="border-b utility-rule pb-7">
          <p className="eyebrow">Mingly</p>
          <h1 className="mt-3 text-[clamp(2rem,5vw,3rem)] font-medium leading-none tracking-[-0.04em]">{copy.title}</h1>
          <p className="mt-5 max-w-2xl text-[11px] leading-6 text-[var(--text-loft-secondary)]">{copy.summary}</p>
          <p className="mt-5 text-[11px] text-[var(--text-loft-muted)]">{copy.updatedLabel}: 20/09/2026</p>
        </header>
        {copy.notice && <aside className="mt-6 rounded-[10px] border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/8 px-4 py-3 text-[11px] leading-6 text-[var(--text-loft-secondary)]">{copy.notice}</aside>}
        <div className="divide-y utility-rule">
          {copy.sections.map((section) => (
            <section key={section.title} className="py-7 sm:py-8">
              <h2 className="text-base font-medium tracking-tight">{section.title}</h2>
              <div className="mt-3 space-y-3 text-[11px] leading-6 text-[var(--text-loft-secondary)]">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        </article>
      </main>
    </div>
  );
}
