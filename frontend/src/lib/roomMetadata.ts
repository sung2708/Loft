import type { Metadata } from "next";
import type { ApiRoomPreview } from "@/types/api";

const fallback: Metadata = {
  title: { absolute: "Loft — We’re here together." },
  description: "A shared space to talk, watch, listen, and hang out together.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Loft — We’re here together.",
    description: "A shared space to talk, watch, listen, and hang out together.",
    siteName: "Loft",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Loft — We’re here together.",
    description: "A shared space to talk, watch, listen, and hang out together.",
  },
};

function isRoomPreview(value: unknown): value is ApiRoomPreview {
  if (!value || typeof value !== "object") return false;
  const room = value as Record<string, unknown>;
  return typeof room.id === "string" && /^[a-zA-Z0-9-]{3,64}$/.test(room.id) &&
    typeof room.name === "string" && typeof room.allow_guests === "boolean";
}

export async function generateRoomMetadata(identifier: string): Promise<Metadata> {
  if (!/^[a-zA-Z0-9-]{3,64}$/.test(identifier)) return fallback;

  try {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
    const response = await fetch(`${apiUrl}/api/v1/rooms/${encodeURIComponent(identifier)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return fallback;
    const data: unknown = await response.json();
    if (!isRoomPreview(data) || !data.allow_guests) return fallback;

    // id is the public identifier exposed by the unauthenticated room preview
    // and /room/{id}. slug is backed by invite_code and is never emitted here.
    const title = `${data.name.trim() || `Room ${data.id}`} · Loft`;
    const description = `Room ${data.id} on Loft — We’re here together.`;
    return {
      title: { absolute: title },
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "Loft",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  } catch {
    return fallback;
  }
}
