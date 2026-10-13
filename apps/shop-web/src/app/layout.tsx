import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { toCssVariablesText } from "@print-automated/design-tokens";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_COOKIE } from "@/lib/cookie-names";
import { parseThemeCookie, themeAttribute } from "@/lib/theme";
import { geistMono, geistSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Print Automated Business", template: "%s · Print Automated Business" },
  description: "Run your print business: orders, production, printers, stock and reports.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  // Read on the server so the first paint is already in the chosen theme.
  const setting = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={themeAttribute(setting)}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Semantic colour/spacing/radius values generated from
            @print-automated/design-tokens (§94), the single source of
            truth; never hand-copied here. */}
        <style dangerouslySetInnerHTML={{ __html: toCssVariablesText() }} />
      </head>
      <body className="min-h-screen bg-surface text-ink antialiased" suppressHydrationWarning>
        <ThemeProvider initial={setting}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
