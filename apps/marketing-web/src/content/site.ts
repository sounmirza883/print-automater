/** A public origin from a NEXT_PUBLIC_* var, inlined at build time. Unset or
 * empty (a declared-but-unset build arg arrives as "", which `??` alone would
 * miss) falls back to the dev port, so `pnpm dev` needs no .env file. */
function publicOrigin(configured: string | undefined, devDefault: string): string {
  const origin = (configured ?? "").trim().replace(/\/+$/, "");
  return origin === "" ? devDefault : origin;
}

// Next.js only replaces the literal `process.env.NEXT_PUBLIC_*` expression,
// so both are read by name here rather than looked up dynamically.
const siteUrl = publicOrigin(process.env.NEXT_PUBLIC_SITE_URL, "http://localhost:3003");
const shopWebUrl = publicOrigin(process.env.NEXT_PUBLIC_SHOP_WEB_URL, "http://localhost:3002");

/** The API origin the pricing section reads the admin-managed plans from
 * (server-side, at request/revalidate time). */
export const apiBaseUrl = publicOrigin(
  process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://localhost:3000",
);

export const siteConfig = {
  name: "Print Automated",
  tagline: "The operating system for print shops",
  description:
    "Print Automated is a simple operating system for printing businesses. Customers order online, jobs route to the right printer automatically, and authorized staff stay in control.",
  url: siteUrl,
  appUrl: shopWebUrl,
  loginUrl: `${shopWebUrl}/login`,
  docsUrl: "/docs",
  contactEmail: "hello@printautomated.example",
  social: {
    twitter: "#",
    linkedin: "#",
    github: "#",
    youtube: "#",
  },
} as const;
