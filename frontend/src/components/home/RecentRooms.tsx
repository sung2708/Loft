"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, KeyRound, Lock, X } from "lucide-react";
import type { LiveCounts, RecentRoom } from "@/types/api";
import { LiveBadge } from "./LiveBadge";

/** Rooms the member entered or was approved into, other than their own. */
export function RecentRooms({
  rooms,
  live,
  vi,
  onForget,
}: {
  rooms: RecentRoom[];
  live: LiveCounts;
  vi: boolean;
  onForget: (room: RecentRoom) => void;
}) {
  const [now] = useState(() => Date.now());
  const relative = new Intl.RelativeTimeFormat(vi ? "vi" : "en", {
    numeric: "auto",
  });
  const ago = (value: string) => {
    const minutes = Math.round((new Date(value).getTime() - now) / 60000);
    if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return relative.format(hours, "hour");
    return relative.format(Math.round(hours / 24), "day");
  };
  return (
    <ul className="mt-4 divide-y divide-[var(--border-loft)] overflow-hidden rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)]">
      {rooms.map((room) => (
        <li
          key={room.id}
          className="group flex items-center gap-3 pr-2 hover:bg-[var(--bg-loft-card)]"
        >
          <Link
            href={`/join/${encodeURIComponent(room.slug)}`}
            className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent-blue)]"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[14px] font-medium">
                  {room.name}
                </span>
                <LiveBadge count={live[room.id]} vi={vi} />
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--text-loft-muted)]">
                <span>
                  {room.owner_name
                    ? `${vi ? "Chủ phòng" : "Host"}: ${room.owner_name}`
                    : null}
                </span>
                <span>{ago(room.last_visited_at)}</span>
                {room.password_required && (
                  <span className="inline-flex items-center gap-1">
                    <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
                    {vi ? "Có mật khẩu" : "Password"}
                  </span>
                )}
                {room.is_locked && (
                  <span className="inline-flex items-center gap-1">
                    <Lock aria-hidden="true" className="h-3.5 w-3.5" />
                    {vi ? "Đã khóa" : "Locked"}
                  </span>
                )}
              </span>
            </span>
            <ArrowUpRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[var(--text-loft-muted)] transition-transform motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
          <button
            type="button"
            onClick={() => onForget(room)}
            aria-label={`${vi ? "Xóa khỏi danh sách gần đây" : "Remove from recent"}: ${room.name}`}
            title={vi ? "Xóa khỏi danh sách gần đây" : "Remove from recent"}
            className="btn-press hover-invert flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--text-loft-muted)]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
