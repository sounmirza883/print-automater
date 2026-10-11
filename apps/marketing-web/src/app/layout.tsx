import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { siteConfig } from "@/content/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const title = `${siteConfig.name} — ${siteConfig.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: title, template: `%s | ${siteConfig.name}` },
  description: siteConfig.description,
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title,
    description: siteConfig.description,
    url: siteConfig.url,
  },
  twitter: { card: "summary_large_image", title, description: siteConfig.description },
};

export const viewport: Viewport = { themeColor: "#0f1630" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>
        <div id="top" />
        {children}
      </body>
    </html>
  );
}
