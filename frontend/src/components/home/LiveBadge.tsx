"use client";

/** People in the room right now; renders nothing for an empty room. */
export function LiveBadge({ count, vi }: { count?: number; vi: boolean }) {
  if (!count) return null;
  const label = vi
    ? `${count} người đang trong phòng`
    : `${count} ${count === 1 ? "person" : "people"} in the room`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-2 py-0.5 text-[12px] font-medium text-[var(--text-loft-primary)]">
      <span aria-hidden="true" className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#1a7f37] opacity-60 motion-safe:animate-ping dark:bg-[#4ac26b]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1a7f37] dark:bg-[#4ac26b]" />
      </span>
      <span className="tabular-nums">{count}</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{vi ? "đang ở đây" : "here now"}</span>
    </span>
  );
}
