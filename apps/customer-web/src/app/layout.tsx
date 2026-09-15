import type { Metadata } from "next";
import type { ReactNode } from "react";
import { toCssVariablesText } from "@print-automated/design-tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: "Print Automated",
  description:
    "Upload a document, configure your print job, and pick it up at a nearby print shop.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        {/* Generated fresh from @print-automated/design-tokens (§94) on
            every render -- the single source of truth for every
            semantic color/spacing/radius value this app uses, never
            hand-copied into this file. */}
        <style dangerouslySetInnerHTML={{ __html: toCssVariablesText() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
