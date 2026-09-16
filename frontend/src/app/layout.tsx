import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mingly.site"),
  title: {
    default: "Mingly — Better when we’re together.",
    template: "%s · Mingly",
  },
  description: "A shared space to talk, watch, listen, and hang out with your people.",
  applicationName: "Mingly",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Mingly — Better when we’re together.",
    description: "A shared space to talk, watch, listen, and hang out with your people.",
    siteName: "Mingly",
    type: "website",
    url: "/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Mingly" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mingly — Better when we’re together.",
    description: "A shared space to talk, watch, listen, and hang out with your people.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      data-astryx-theme="neutral"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem("loft.theme") || "system";
                const resolved = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
                document.documentElement.classList.add(resolved);
                document.documentElement.dataset.theme = theme;
              } catch {
                document.documentElement.classList.add("dark");
              }
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider><ThemeProvider>{children}</ThemeProvider></I18nProvider>
      </body>
    </html>
  );
}
