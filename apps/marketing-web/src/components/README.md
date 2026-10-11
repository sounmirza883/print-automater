# marketing-web component conventions

Import primitives from `@/components/ui` (barrel) and use `cn` from `@/lib/cn`.
Server components by default; only add `"use client"` when you need state/effects.
Design tokens (Tailwind classes): `brand-50..900` (600 = #2563EB), `ink-50..950`
(navy; dark bands use `ink-950`), `cmyk-cyan|magenta|yellow` (tiny accents/status dots only),
`font-sans` (Inter), `font-mono` (JetBrains Mono, for eyebrows/labels/numbers).

## Section skeleton

```tsx
<Section id="features" tone="muted">
  <SectionHeader id="features" eyebrow="Features" title="..." lede="..." />
  ...
</Section>
```

Section root ids are fixed (nav links target them): hero, overview, features, capabilities,
product-preview, how-it-works, use-cases, security, integrations, pricing, resources,
testimonials, faq, final-cta. Alternate `tone` for rhythm: hero/product-preview/final-cta = `dark`,
others `light` / `muted`.

## Props

- `Container({ as?: ElementType, ...div props })` - `max-w-7xl`, 16px mobile gutter (px-4 sm:px-6 lg:px-8).
- `Section({ id: string; tone?: "light"|"muted"|"dark" (light); labelledBy?: string; containerClassName?: string; ...section props })`
  - renders `<section id aria-labelledby="{id}-title">` with `py-20 md:py-28` and wraps children in `Container`.
  - Not using SectionHeader? pass `labelledBy=""` plus `aria-label`.
- `SectionHeader({ id: string; eyebrow?: string; title: ReactNode; lede?: ReactNode; align?: "left"|"center" (center); tone?: "light"|"dark" (light); as?: "h1"|"h2" (h2); className? })`
  - heading gets `id="{id}-title"`. `tone="dark"` must match a dark Section.
- `Button` - polymorphic: with `href` renders `<a>`, without renders `<button type="button">`.
  `{ variant?: "primary"|"secondary"|"ghost" (primary); size?: "sm"|"md"|"lg" (md); tone?: "light"|"dark" (light; set "dark" on dark bands); fullWidth?: boolean; ...anchor/button attrs }`
- `Card({ tone?: "light"|"dark"; interactive?: boolean (hover lift); padded?: boolean (true, p-6); ...div props })`
- `Badge({ variant?: "neutral"|"brand"|"success"|"warning"|"outline"|"dark"; dot?: "cyan"|"magenta"|"yellow"|"green"|"brand"; ...span props })`
- `IconTile({ icon: LucideIcon; size?: "sm"|"md"|"lg" (md); tone?: "brand"|"light"|"dark" (light); className? })` - always aria-hidden; pair with text.
- `Reveal({ children; delay?: number (ms); as?: ElementType (div); className? })` - client component; content is
  visible in SSR/no-JS and if already in viewport, fades in only when scrolled to. Wrap blocks, not the whole section.
- `cn(...values)` - joins strings, skips falsy, flattens arrays.

## Content

Copy lives in `src/content/*.ts` (typed). `siteConfig` in `content/site.ts` holds `appUrl`
and `loginUrl` (both shop-web's staff/admin console — there is no public sign-up; shops are
provisioned by an admin) and `docsUrl`. Use those for CTAs; never hard-code URLs.
`appUrl`/`loginUrl` come from `NEXT_PUBLIC_SHOP_WEB_URL` and `url` from `NEXT_PUBLIC_SITE_URL`
(both inlined at build time; unset falls back to the dev ports 3002 and 3003).
Icons: `lucide-react` (no brand logos there; use text monograms for integrations).
