import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Loft — We’re here together.",
    template: "%s · Loft",
  },
  description: "A shared space to talk, watch, listen, and hang out together.",
  applicationName: "Loft",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      data-astryx-theme="neutral"
      className={`${inter.className} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <I18nProvider><ThemeProvider>{children}</ThemeProvider></I18nProvider>
      </body>
    </html>
  );
}
