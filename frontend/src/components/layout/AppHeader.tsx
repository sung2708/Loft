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
  subtitle,
  title = "Mingly",
}: AppHeaderProps) {
  return (
    <header
      className={`${fixed ? "fixed top-0 left-0 right-0" : "relative"} z-50 w-full border-b border-[var(--border-loft)] bg-[var(--bg-loft-base)]/92 shadow-[var(--shadow-contact)] backdrop-blur-md transition-colors duration-200`}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-2 px-4 sm:gap-3 sm:px-8">
        <Link href="/" aria-label={typeof title === "string" ? title : "Mingly"} className="flex shrink-0 items-center gap-2 sm:gap-3 text-[var(--text-loft-primary)]">
          <LoftMark className="h-10 w-10 shrink-0" />
          <span className="hidden min-w-0 flex-col select-none min-[360px]:flex">
            <span className="loft-wordmark text-base">{title}</span>
            {subtitle ? (
              <span className="hidden truncate text-[11px] leading-tight text-[var(--text-loft-muted)] sm:block">
                {subtitle}
              </span>
            ) : null}
          </span>
        </Link>
        {center ? <div className="hidden min-w-0 flex-1 justify-center md:flex">{center}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-2 sm:gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
