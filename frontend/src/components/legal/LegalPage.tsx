import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";

type LegalSection = {
  title: string;
  content: ReactNode;
};

export function LegalPage({
  title,
  summary,
  sections,
  languageHref,
  languageLabel,
  backLabel,
  updatedLabel,
}: {
  title: string;
  summary: string;
  sections: LegalSection[];
  languageHref: string;
  languageLabel: string;
  backLabel: string;
  updatedLabel: string;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)]">
      <AppHeader subtitle="" />
      <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-24 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[11px] text-[var(--text-loft-secondary)] transition-colors hover:text-[var(--text-loft-primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
          <Link
            href={languageHref}
            className="text-[11px] text-[var(--text-loft-secondary)] underline decoration-[var(--border-loft)] underline-offset-4 transition-colors hover:text-[var(--text-loft-primary)]"
          >
            {languageLabel}
          </Link>
        </div>
        <header className="mt-8 border-b border-[var(--border-loft)] pb-8">
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-[11px] leading-6 text-[var(--text-loft-secondary)]">
            {summary}
          </p>
          <p className="mt-4 text-[11px] text-[var(--text-loft-muted)]">{updatedLabel}: 16/09/2026</p>
        </header>
        <div className="divide-y divide-[var(--border-loft)]">
          {sections.map((section) => (
            <section key={section.title} className="py-8">
              <h2 className="text-base font-medium tracking-tight">{section.title}</h2>
              <div className="mt-3 space-y-3 text-[11px] leading-6 text-[var(--text-loft-secondary)]">
                {section.content}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
