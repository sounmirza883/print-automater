import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { toCssVariablesText } from "@print-automated/design-tokens";
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

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        {/* Semantic colour/spacing/radius values generated from
            @print-automated/design-tokens (§94), the single source of
            truth; never hand-copied here. */}
        <style dangerouslySetInnerHTML={{ __html: toCssVariablesText() }} />
      </head>
      <body className="min-h-screen bg-surface text-ink antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
