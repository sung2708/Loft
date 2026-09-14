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
  title: "Loft — The Digital Social Hangout",
  description:
    "Realtime social hangout platform where friends talk, watch, listen, and co-work in synchronized rooms.",
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
