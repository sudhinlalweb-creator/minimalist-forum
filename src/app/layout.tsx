import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * `metadataBase` makes every per-page canonical and Open Graph URL absolute,
 * which Phase 4 depends on. Per-page metadata overrides title/description.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Meridian",
    template: "%s · Meridian",
  },
  description:
    "A minimalist forum for product, design and engineering discussion.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The design is dark-first with an explicit toggle rather than a
    // prefers-color-scheme reaction, so dark is the served default and the
    // Phase 5 toggle flips data-theme="light".
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="bg-bg text-text min-h-full font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
