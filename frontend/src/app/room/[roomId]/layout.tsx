import type { Metadata } from "next";
import { generateRoomMetadata } from "@/lib/roomMetadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;
  return generateRoomMetadata(roomId);
}

export default function ActiveRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
