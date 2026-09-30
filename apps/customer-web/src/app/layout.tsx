import type { Metadata } from "next";
import type { ReactNode } from "react";
import { toCssVariablesText } from "@print-automated/design-tokens";
// Fix wave 1: nothing server-side calls the API any more (the QR flow's
// browser code does, directly -- lib/public-api.ts), so no route handler
// loads env.ts now. Loading it here keeps the one check that matters:
// `next build` prerenders through this layout, so a missing or malformed
// NEXT_PUBLIC_API_BASE_URL -- the value inlined into the browser bundle --
// fails the build instead of shipping calls to relative paths.
import "@/env";
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
