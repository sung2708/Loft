import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join Room",
  description: "A shared space to talk, watch, listen, and hang out together.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Join Room · Loft",
    description: "A shared space to talk, watch, listen, and hang out together.",
    siteName: "Loft",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Join Room · Loft",
    description: "A shared space to talk, watch, listen, and hang out together.",
  },
};

export default function JoinRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
