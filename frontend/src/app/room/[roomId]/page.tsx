"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, loadCredential, saveCredential } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { RoomSession } from "@/features/room/RoomSession";
import type { RoomCredential } from "@/types/api";
import { useUIText } from "@/lib/i18n/uiText";
import Link from "next/link";

export default function ActiveRoomPage() {
  const tr = useUIText();
  const router = useRouter();
  const identifier = String(useParams<{ roomId: string }>().roomId);
  const [credential, setCredential] = useState<RoomCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const room = await api.room(identifier);
        if (room.slug && room.slug !== identifier) {
          router.replace(`/room/${encodeURIComponent(room.slug)}`);
          return;
        }
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
  }, [identifier, router]);
  if (error)
    return (
      <main className="app-canvas utility-page flex items-center justify-center p-4 sm:p-6">
        <section role="alert" className="utility-panel w-full max-w-sm rounded-[6px] p-6 text-center sm:p-8">
          <p className="eyebrow">Mingly</p>
          <h1 className="mt-3 text-base font-medium tracking-tight">{tr("Room unavailable")}</h1>
          <p className="mt-2 text-[11px] text-[var(--text-loft-secondary)]">
            {tr(error)}
          </p>
          <Link href="/" className="control-primary mt-5 inline-flex h-10 items-center rounded-[6px] px-4 text-[11px] font-medium">
            {tr("Return home")}
          </Link>
        </section>
      </main>
    );
  if (!credential)
    return (
      <main className="app-canvas utility-page flex items-center justify-center p-4">
        <div aria-live="polite" className="utility-panel flex w-full max-w-xs flex-col items-center rounded-[6px] p-6 text-center">
          <div className="app-loader" aria-hidden="true" />
          <p className="mt-4 text-[11px] text-[var(--text-loft-secondary)]">{tr("Preparing room…")}</p>
        </div>
      </main>
    );
  return <RoomSession credential={credential} />;
}
