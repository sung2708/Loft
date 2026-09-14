"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, loadCredential, saveCredential } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { RoomSession } from "@/features/room/RoomSession";
import type { RoomCredential } from "@/types/api";
import { useUIText } from "@/lib/i18n/uiText";

export default function ActiveRoomPage() {
  const tr = useUIText();
  const identifier = String(useParams<{ roomId: string }>().roomId);
  const [credential, setCredential] = useState<RoomCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const room = await api.room(identifier);
        const existing = loadCredential(room.id);
        if (existing?.type === "guest") {
          setCredential(existing);
          return;
        }
        const session = (await getSupabase()?.auth.getSession())?.data.session;
        if (session) {
          const me = await api.me(session.access_token);
          const next = {
            token: session.access_token,
            type: "user" as const,
            roomId: room.id,
            displayName: me.display_name,
          };
          saveCredential(room.id, next);
          setCredential(next);
          return;
        }
        location.replace(`/join/${room.slug}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Room not found");
      }
    })();
  }, [identifier]);
  if (error)
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-3xl p-8 text-center">
          <h1 className="text-xl font-semibold">{tr("Room unavailable")}</h1>
          <p className="mt-2 text-sm text-[var(--text-loft-secondary)]">
            {tr(error)}
          </p>
          <a
            href="/"
            className="inline-block mt-5 px-4 py-2 rounded-xl bg-[#0066CC] text-white"
          >
            {tr("Return home")}
          </a>
        </div>
      </main>
    );
  if (!credential)
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-[var(--text-loft-secondary)]">
        {tr("Preparing room…")}
      </main>
    );
  return <RoomSession credential={credential} />;
}
