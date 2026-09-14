import type { Metadata } from "next";
import type { ApiRoomPreview } from "@/types/api";

const fallback: Metadata = {
  title: "Join a room | Loft",
  description: "Join friends in a Loft room for voice, video, and shared music.",
};

function isRoomPreview(value: unknown): value is ApiRoomPreview {
  if (!value || typeof value !== "object") return false;
  const room = value as Record<string, unknown>;
  return typeof room.id === "string" && room.id.length > 0 &&
    typeof room.slug === "string" && room.slug.length > 0 &&
    typeof room.name === "string" && room.name.length > 0;
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
    if (!isRoomPreview(data)) return fallback;

    const title = `${data.name} | Loft`;
    const description = `Tham gia phòng ${data.name} trên Loft. ID phòng: ${data.id}.`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "Loft",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return fallback;
  }
}
