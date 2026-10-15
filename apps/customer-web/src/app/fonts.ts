import localFont from "next/font/local";

/** Geist, vendored (SIL OFL 1.1, see ./fonts/OFL.txt) rather than fetched from
 * Google at build time, so a build never depends on the network. */
export const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

/** Not preloaded (unlike shop-web): it only draws the order number, the copies
 * count and the money figures, and a guest's first scan is often on mobile
 * data. */
export const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
});
