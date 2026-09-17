"use client";

import { useState } from "react";
import { useRoomStore } from "@/stores/useRoomStore";
import { useYouTubePicksStore } from "@/stores/useYouTubePicksStore";
import { useRoomSession } from "./RoomSession";

export function YouTubeRoomPicks() {
  const room = useRoomStore((state) => state.room);
  const self = useRoomStore((state) => state.self);
  const picks = useYouTubePicksStore((state) => state.picks);
  const session = useRoomSession();
  const [error, setError] = useState<string | null>(null);

  const vote = (pickID: string) => {
    setError(null);
    if (!session.sendCommand("youtube.pick.vote", { pick_id: pickID })) {
      setError("Could not vote for this pick.");
    }
  };

  const promote = (pickID: string) => {
    setError(null);
    if (!session.sendCommand("youtube.pick.promote", { pick_id: pickID })) {
      setError("Could not promote this pick.");
    }
  };

  const isHost = self?.identity_id === room?.owner_id;

  return (
    <section className="rounded-[6px] border border-[var(--border-loft)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium">Room Picks</p>
        <span className="text-[10px] text-[var(--text-loft-secondary)]">
          {picks.length}
        </span>
      </div>

      {error && <p className="mt-2 text-[10px] text-[var(--status-danger)]">{error}</p>}

      {picks.length === 0 && !error && (
        <p className="mt-2 text-[10px] text-[var(--text-loft-secondary)]">
          No room picks yet. Suggest videos using search above.
        </p>
      )}

      {picks.map((pick) => (
        <div key={pick.id} className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px]">
            {pick.title || pick.video_id}
            <span className="block truncate text-[10px] text-[var(--text-loft-secondary)]">
              {pick.channel || "YouTube"} · {pick.votes} {pick.votes === 1 ? "vote" : "votes"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => vote(pick.id)}
            className="rounded border border-[var(--border-loft)] px-2 py-1 text-[10px] hover-invert"
          >
            Vote
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => promote(pick.id)}
              className="rounded bg-[var(--accent-blue)] px-2 py-1 text-[10px] text-white"
            >
              Play
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
