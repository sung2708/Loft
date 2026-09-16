import Link from "next/link";
import type { ReactNode } from "react";
import { LoftMark } from "@/components/brand/LoftMark";

type AppHeaderProps = {
  actions?: ReactNode;
  center?: ReactNode;
  fixed?: boolean;
  subtitle?: ReactNode;
  title?: ReactNode;
};

export function AppHeader({
  actions,
  center,
  fixed = true,
  subtitle = "Better when we’re together.",
  title = "Mingly",
}: AppHeaderProps) {
  return (
    <header
      className={`${fixed ? "fixed top-0 left-0 right-0" : "relative"} z-50 w-full border-b border-[var(--border-loft)] bg-[var(--bg-loft-base)]/95 backdrop-blur-xl`}
    >
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
        <Link href="/" aria-label="Mingly — Better when we’re together." className="flex min-w-0 items-center gap-3 text-[var(--text-loft-primary)]">
          <LoftMark className="h-10 w-10 shrink-0" />
          <span className="flex min-w-0 flex-col select-none">
            <span className="loft-wordmark truncate text-base">{title}</span>
            {subtitle ? (
              <span className="hidden truncate text-[11px] leading-tight text-[var(--text-loft-muted)] sm:block">
                {subtitle}
              </span>
            ) : null}
          </span>
        </Link>
        {center ? <div className="hidden min-w-0 flex-1 justify-center md:flex">{center}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
