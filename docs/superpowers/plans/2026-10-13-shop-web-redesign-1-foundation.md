# Business Console Redesign, Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every screen of `apps/shop-web` into the new monochrome identity in both light and dark, with an in-app theme setting, without touching any screen's behaviour.

**Architecture:** The console already styles everything through semantic Tailwind tokens (`bg-panel`, `text-muted`, `border-line`) defined once in `src/app/globals.css`, and through a small shared kit (`ui.tsx`, `form-kit.tsx`, `modal.tsx`). This phase redefines the tokens for two themes selected by `<html data-theme>`, restyles the kit in place (same exports and props), and sweeps the few places that hard-code colours. Phases 2 (shell) and 3 (screens) have their own plans.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS 4 (`@theme inline`), `next/font/local`, jest + ts-jest (tests are `*.test.ts`, components render with `createElement` + `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-13-shop-web-console-redesign-design.md`

## Global Constraints

- Edit only files under `apps/shop-web/`. Do not touch `packages/design-tokens`.
- **Do not `git add`, `git commit`, `git stash`, `git checkout --` or `git restore` anything.** The working tree is shared with other sessions and already holds someone else's uncommitted work (`src/lib/billing-view.ts`, `src/lib/nav.ts`, `src/app/layout.tsx`, `src/app/login/page.tsx`, `src/app/(console)/admin/reports/`, `src/components/admin/payment-report-screen.tsx`). Build on top of it; keep every `suppressHydrationWarning` already present.
- **Never kill a process you did not start. Do not start a dev server.**
- No API, permission, route or behaviour changes. Every existing export keeps its name, props and return value.
- Copy says "Business", never "Shop". Do not rename the `Shop` model, routes or types.
- Colour comes only from token utilities. `text-white` is allowed only together with `bg-danger`. `bg-black/NN` is allowed only on a dialog backdrop or scrim. `bg-white` is allowed only behind the QR code.
- Primary actions are `bg-inv text-inv-ink`, never `bg-accent text-white`.
- Run every command from `apps/shop-web`, through the binaries directly, under `timeout` (pnpm wrappers have orphaned hung children on this machine):
  - typecheck: `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit`
  - lint: `timeout 300 node ../../node_modules/eslint/bin/eslint.js .`
  - tests: `timeout 600 node ../../node_modules/jest/bin/jest.js`
  - one test file: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/theme.test.ts`
  - build: `timeout 900 node node_modules/next/dist/bin/next build`
- Match the surrounding code: explicit `: ReactNode` return types, double quotes, doc comments that say why.

## Review Focus

1. A tampered or garbage `shop_theme` cookie (`"><script>`, `DARK`, empty): the page must render as "system" and never echo the value into `data-theme`. Pinned in Task 1 (`theme.test.ts`).
2. Operating system in dark mode with the setting "Light" (and the reverse): the setting must win. The dark values are written twice in the CSS (media query and attribute), so the two blocks can drift. Pinned in Task 1 (`globals.test.ts` asserts both selectors exist and that all three blocks define the same variables).
3. Text that is readable in light but not in dark: every text/background token pair must reach 4.5:1 in both themes. Pinned in Task 1 (`globals.test.ts` computes contrast from the CSS).
4. A primary button in dark mode rendering white on white because a screen still says `bg-accent text-white`. Pinned in Task 3 (`colour-guard.test.ts` scans the source).
5. People and business names that are one word, empty, padded with spaces or not Latin (Urdu): avatar initials must not crash or render blank. Pinned in Task 2 (`format.test.ts`).

---

### Task 1: Theme setting, tokens for both themes, fonts

**Files:**

- Create: `src/lib/theme.ts`, `src/lib/theme.test.ts`
- Create: `src/app/globals.test.ts`
- Create: `src/app/fonts.ts`
- Create: `src/components/theme-provider.tsx`
- Modify: `src/lib/cookie-names.ts` (append one constant)
- Modify: `src/app/globals.css` (replace whole file)
- Modify: `src/app/layout.tsx`
- Already present, do not regenerate: `src/app/fonts/Geist-Variable.woff2`, `src/app/fonts/GeistMono-Variable.woff2`, `src/app/fonts/OFL.txt`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - `THEME_COOKIE = "shop_theme"` from `@/lib/cookie-names`
  - from `@/lib/theme`: `type ThemeSetting = "light" | "dark" | "system"`; `THEME_SETTINGS: readonly ThemeSetting[]`; `parseThemeCookie(value: string | null | undefined): ThemeSetting`; `themeAttribute(setting: ThemeSetting): "light" | "dark" | undefined`; `themeCookie(setting: ThemeSetting): string`; `resolvedTheme(setting: ThemeSetting, osPrefersDark: boolean): "light" | "dark"`
  - from `@/components/theme-provider`: `ThemeProvider({ initial, children })`, `useTheme(): { setting: ThemeSetting; resolved: "light" | "dark"; setTheme(next: ThemeSetting): void }`
  - Tailwind utilities for the new tokens: `ink-2`, `line-strong`, `inv`, `inv-ink` (as `bg-`, `text-`, `border-`), `shadow-panel`; `rounded-md` is now 9px and `rounded-lg` 12px.

- [ ] **Step 1: Write the failing tests for the theme helpers**

Create `src/lib/theme.test.ts`:

```ts
import { parseThemeCookie, resolvedTheme, themeAttribute, themeCookie } from "./theme";

describe("parseThemeCookie", () => {
  it("returns a saved light or dark setting", () => {
    expect(parseThemeCookie("light")).toBe("light");
    expect(parseThemeCookie("dark")).toBe("dark");
  });

  it("treats a missing, empty, explicit-system or unknown value as system", () => {
    for (const value of [undefined, null, "", "system", "DARK", " dark", "blue"]) {
      expect(parseThemeCookie(value)).toBe("system");
    }
  });

  it("never passes a tampered value through", () => {
    expect(parseThemeCookie('"><script>alert(1)</script>')).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("is the setting itself for light and dark", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });

  it("is absent for system, so CSS follows the operating system", () => {
    expect(themeAttribute("system")).toBeUndefined();
  });
});

describe("themeCookie", () => {
  it("saves the setting for a year, for the whole site", () => {
    expect(themeCookie("dark")).toBe("shop_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(themeCookie("system")).toBe("shop_theme=system; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});

describe("resolvedTheme", () => {
  it("lets an explicit setting win over the operating system", () => {
    expect(resolvedTheme("light", true)).toBe("light");
    expect(resolvedTheme("dark", false)).toBe("dark");
  });

  it("follows the operating system for system", () => {
    expect(resolvedTheme("system", true)).toBe("dark");
    expect(resolvedTheme("system", false)).toBe("light");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/theme.test.ts`
Expected: FAIL, "Cannot find module './theme'".

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/cookie-names.ts`:

```ts
/** The person's Light / Dark / System choice. Read by the root layout so the
 * first paint is already in the right theme; display-only, like the cookie above. */
export const THEME_COOKIE = "shop_theme";
```

Create `src/lib/theme.ts`:

```ts
import { THEME_COOKIE } from "@/lib/cookie-names";

/** What the person chose. "system" follows the operating system. */
export type ThemeSetting = "light" | "dark" | "system";

export const THEME_SETTINGS: readonly ThemeSetting[] = ["light", "dark", "system"];

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The saved setting. Anything that is not exactly "light" or "dark" (missing,
 * tampered, a future value) is "system", so a cookie can never inject markup. */
export function parseThemeCookie(value: string | null | undefined): ThemeSetting {
  return value === "light" || value === "dark" ? value : "system";
}

/** The value for `<html data-theme>`. Undefined means no attribute, and the
 * stylesheet then follows `prefers-color-scheme`. */
export function themeAttribute(setting: ThemeSetting): "light" | "dark" | undefined {
  return setting === "system" ? undefined : setting;
}

/** The `document.cookie` string that remembers the setting for a year. */
export function themeCookie(setting: ThemeSetting): string {
  return `${THEME_COOKIE}=${setting}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** The theme actually on screen. */
export function resolvedTheme(setting: ThemeSetting, osPrefersDark: boolean): "light" | "dark" {
  if (setting === "system") {
    return osPrefersDark ? "dark" : "light";
  }
  return setting;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/theme.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing stylesheet tests**

Create `src/app/globals.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The custom properties declared in the block opened by `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`selector not found: ${selector}`);
  }
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const vars: Record<string, string> = {};
  const pattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match = pattern.exec(body);
  while (match !== null) {
    vars[match[1]] = match[2].trim();
    match = pattern.exec(body);
  }
  return vars;
}

const LIGHT = block(":root {");
const DARK_BY_SYSTEM = block(':root:not([data-theme="light"]) {');
const DARK_BY_SETTING = block(':root[data-theme="dark"] {');

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channel = (byte: number): number => {
    const srgb = byte / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** [text token, background token]: every pairing the kit puts on screen. */
const TEXT_ON: ReadonlyArray<[string, string]> = [
  ["--ink", "--surface"],
  ["--ink", "--panel"],
  ["--ink", "--panel-2"],
  ["--ink-2", "--panel"],
  ["--ink-2", "--panel-2"],
  ["--muted", "--surface"],
  ["--muted", "--panel"],
  ["--muted", "--panel-2"],
  ["--side-ink", "--side"],
  ["--inv-ink", "--inv"],
  ["--accent-fg", "--panel"],
  ["--accent-fg", "--accent-soft"],
  ["--good-fg", "--panel"],
  ["--good-fg", "--good-soft"],
  ["--warn-fg", "--panel"],
  ["--warn-fg", "--caution-soft"],
  ["--bad-fg", "--panel"],
  ["--bad-fg", "--danger-soft"],
];

describe("globals.css themes", () => {
  it("defines the same variables in light and in both dark blocks", () => {
    const names = Object.keys(LIGHT).sort();
    expect(names.length).toBeGreaterThan(15);
    expect(Object.keys(DARK_BY_SYSTEM).sort()).toEqual(names);
    expect(Object.keys(DARK_BY_SETTING).sort()).toEqual(names);
  });

  it("keeps the two dark blocks identical, so the setting and the OS give the same dark", () => {
    expect(DARK_BY_SETTING).toEqual(DARK_BY_SYSTEM);
  });

  it("lets a Light setting win over a dark operating system", () => {
    const media = css.indexOf("@media (prefers-color-scheme: dark)");
    const systemDark = css.indexOf(':root:not([data-theme="light"]) {');
    expect(media).toBeGreaterThan(-1);
    expect(systemDark).toBeGreaterThan(media);
  });

  it.each(TEXT_ON)("%s on %s reaches 4.5:1 in light", (text, background) => {
    expect(contrast(LIGHT[text], LIGHT[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_ON)("%s on %s reaches 4.5:1 in dark", (text, background) => {
    expect(contrast(DARK_BY_SETTING[text], DARK_BY_SETTING[background])).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/app/globals.test.ts`
Expected: FAIL, "selector not found: :root:not([data-theme="light"]) {".

- [ ] **Step 7: Replace `src/app/globals.css`**

Write the whole file:

```css
@import "tailwindcss";

/* The console's two themes. Surfaces, text and status-text colours live
   here, in ONE place; the five semantic FILL colours (primary action,
   success, warning, error, neutral) still come from
   @print-automated/design-tokens (injected as --color-* by layout.tsx),
   which other apps share and which carries no dark palette.

   Which theme applies: `<html data-theme="light|dark">` when the person chose
   one (app/layout.tsx renders it from the shop_theme cookie), otherwise the
   operating system. CSS has no way to share a block between a media query
   and a selector, so the dark values are written twice; globals.test.ts
   fails if the two copies drift or a text/background pair drops under 4.5:1. */
:root {
  color-scheme: light;
  --surface: #f6f6f6;
  --panel: #ffffff;
  --panel-2: #f0f0f0;
  --ink: #0a0a0a;
  --ink-2: #3a3a3a;
  --muted: #646464;
  --line: #e3e3e3;
  --line-strong: #cfcfcf;
  --side: #ffffff;
  --side-ink: #3a3a3a;
  --side-line: #e3e3e3;
  --inv: #0a0a0a;
  --inv-ink: #ffffff;
  --accent-fg: #1e46b8;
  --good-fg: #166534;
  --warn-fg: #8a4b0a;
  --bad-fg: #b42318;
  --accent-soft: #e8effe;
  --good-soft: #e7f6ec;
  --caution-soft: #fdf1dc;
  --danger-soft: #fdeceb;
  --panel-shadow: 0 1px 2px rgb(10 10 10 / 0.06);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #0a0a0a;
    --panel: #131313;
    --panel-2: #1c1c1c;
    --ink: #f5f5f5;
    --ink-2: #d0d0d0;
    --muted: #a0a0a0;
    --line: #272727;
    --line-strong: #3a3a3a;
    --side: #0a0a0a;
    --side-ink: #d0d0d0;
    --side-line: #272727;
    --inv: #f5f5f5;
    --inv-ink: #0a0a0a;
    --accent-fg: #93b4ff;
    --good-fg: #4ade80;
    --warn-fg: #fbbf24;
    --bad-fg: #f87171;
    --accent-soft: #111b33;
    --good-soft: #0f2417;
    --caution-soft: #2a1f08;
    --danger-soft: #2b1212;
    --panel-shadow: 0 0 0 0 transparent;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #0a0a0a;
  --panel: #131313;
  --panel-2: #1c1c1c;
  --ink: #f5f5f5;
  --ink-2: #d0d0d0;
  --muted: #a0a0a0;
  --line: #272727;
  --line-strong: #3a3a3a;
  --side: #0a0a0a;
  --side-ink: #d0d0d0;
  --side-line: #272727;
  --inv: #f5f5f5;
  --inv-ink: #0a0a0a;
  --accent-fg: #93b4ff;
  --good-fg: #4ade80;
  --warn-fg: #fbbf24;
  --bad-fg: #f87171;
  --accent-soft: #111b33;
  --good-soft: #0f2417;
  --caution-soft: #2a1f08;
  --danger-soft: #2b1212;
  --panel-shadow: 0 0 0 0 transparent;
}

@theme inline {
  --color-surface: var(--surface);
  --color-panel: var(--panel);
  --color-panel-2: var(--panel-2);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-side: var(--side);
  --color-side-ink: var(--side-ink);
  --color-side-line: var(--side-line);
  --color-inv: var(--inv);
  --color-inv-ink: var(--inv-ink);
  --color-quiet: var(--color-neutral);
  --color-accent: var(--color-primary-action);
  --color-accent-fg: var(--accent-fg);
  --color-good: var(--color-success);
  --color-good-fg: var(--good-fg);
  --color-caution: var(--color-warning);
  --color-caution-fg: var(--warn-fg);
  --color-danger: var(--color-error);
  --color-danger-fg: var(--bad-fg);
  --color-accent-soft: var(--accent-soft);
  --color-good-soft: var(--good-soft);
  --color-caution-soft: var(--caution-soft);
  --color-danger-soft: var(--danger-soft);
  --shadow-panel: var(--panel-shadow);
  /* Every screen says rounded-md for controls and rounded-lg for panels;
     re-pointing the two steps re-shapes all of them at once. */
  --radius-md: 0.5625rem;
  --radius-lg: 0.75rem;
  --font-sans:
    var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
    sans-serif;
  --font-mono:
    var(--font-geist-mono), ui-monospace, "Cascadia Mono", "SFMono-Regular", Menlo, Consolas,
    monospace;
}

html {
  background: var(--surface);
  color: var(--ink);
}

body {
  /* Written out rather than var(--font-sans): an `inline` theme value is not
     guaranteed to exist as a variable outside Tailwind's own utilities. */
  font-family:
    var(--font-geist-sans),
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  font-size: 14px;
  line-height: 20px;
  -webkit-font-smoothing: antialiased;
}

/* Identifiers and figures that must line up in columns. */
.num {
  font-family:
    var(--font-geist-mono), ui-monospace, "Cascadia Mono", "SFMono-Regular", Menlo, Consolas,
    monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

/* One consistent, visible keyboard focus ring. */
:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

@layer base {
  a,
  button,
  input,
  select,
  textarea,
  summary {
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      box-shadow 150ms ease,
      opacity 150ms ease;
  }
}

@keyframes shimmer {
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: calc(200px + 100%) 0;
  }
}

.skeleton {
  background-color: var(--panel-2);
  background-image: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--ink) 7%, transparent),
    transparent
  );
  background-size: 200px 100%;
  background-repeat: no-repeat;
  animation: shimmer 1.4s infinite;
  border-radius: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
  * {
    scroll-behavior: auto !important;
    transition: none !important;
  }
}
```

- [ ] **Step 8: Run the stylesheet tests and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/app/globals.test.ts`
Expected: PASS (3 structural tests + 36 contrast cases). If a contrast case fails, the hex in the CSS was mistyped; fix the CSS, not the test.

- [ ] **Step 9: Load the fonts**

Create `src/app/fonts.ts`:

```ts
import localFont from "next/font/local";

/** Geist, vendored (SIL OFL 1.1, see ./fonts/OFL.txt) rather than fetched from
 * Google at build time, so a build never depends on the network. */
export const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});
```

- [ ] **Step 10: Add the theme provider**

Create `src/components/theme-provider.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { resolvedTheme, themeAttribute, themeCookie, type ThemeSetting } from "@/lib/theme";

interface ThemeValue {
  /** What the person chose. */
  setting: ThemeSetting;
  /** What is on screen: the setting, or the operating system's for "system". */
  resolved: "light" | "dark";
  setTheme: (next: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const OS_DARK = "(prefers-color-scheme: dark)";

function subscribeToOs(onChange: () => void): () => void {
  const query = window.matchMedia(OS_DARK);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}

/** Holds the Light / Dark / System setting. The server has already rendered
 * `<html data-theme>` from the cookie (app/layout.tsx); a change here rewrites
 * the cookie and the attribute together, so the choice shows at once and
 * survives a reload without a flash of the other theme. */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: ThemeSetting;
  children: ReactNode;
}): ReactNode {
  const [setting, setSetting] = useState<ThemeSetting>(initial);
  const osPrefersDark = useSyncExternalStore(
    subscribeToOs,
    () => window.matchMedia(OS_DARK).matches,
    () => false,
  );

  const setTheme = useCallback((next: ThemeSetting): void => {
    setSetting(next);
    document.cookie = themeCookie(next);
    const attribute = themeAttribute(next);
    if (attribute === undefined) {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = attribute;
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ setting, resolved: resolvedTheme(setting, osPrefersDark), setTheme }),
    [setting, osPrefersDark, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

- [ ] **Step 11: Wire the root layout**

In `src/app/layout.tsx`, keep `metadata` and `viewport` as they are and replace the imports and `RootLayout` with:

```tsx
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { toCssVariablesText } from "@print-automated/design-tokens";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_COOKIE } from "@/lib/cookie-names";
import { parseThemeCookie, themeAttribute } from "@/lib/theme";
import { geistMono, geistSans } from "./fonts";
import "./globals.css";
```

```tsx
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
```

- [ ] **Step 12: Verify the task**

Run, in this order:

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: no output, exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes (the pre-existing suites plus `theme.test.ts` and `globals.test.ts`).

- [ ] **Step 13: Leave the work uncommitted** and report the files changed and the exact command results.

---

### Task 2: Restyle the component kit and add the new primitives

**Files:**

- Modify: `src/components/ui.tsx`, `src/components/form-kit.tsx`, `src/components/modal.tsx`
- Create: `src/components/segmented.tsx`, `src/components/tabs.tsx`, `src/components/menu.tsx`
- Modify: `src/lib/format.ts`, `src/lib/format.test.ts` (add `initialsOf`)
- Create: `src/components/ui.test.ts`

**Interfaces:**

- Consumes (Task 1): utilities `bg-inv`, `text-inv-ink`, `text-ink-2`, `border-line-strong`, `shadow-panel`.
- Produces:
  - `ui.tsx`: every existing export unchanged in name and props, plus: `Button` gains `variant?: "primary" | "secondary" | "ghost" | "danger"`, `size?: "sm" | "md"`, `className?: string`; new `IconButton({ label, onClick?, href?, children, className? })`, `Avatar({ name, size?: "sm" | "md", tone?: "inv" | "soft", round?: boolean })`, `Kbd({ children })`, `Toolbar({ children, className? })`.
  - `segmented.tsx`: `Segmented<T extends string>({ value, onChange, options, ariaLabel, className? })` with `options: ReadonlyArray<{ value: T; label: ReactNode; ariaLabel?: string }>`.
  - `tabs.tsx`: `Tabs({ items, activeId, onSelect?, ariaLabel, className? })` with `items: ReadonlyArray<{ id: string; label: string; count?: number | string; href?: string; emphasis?: boolean }>`.
  - `menu.tsx`: `Menu({ label, trigger, children, align?: "start" | "end", side?: "bottom" | "top", className? })` where `trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode` and `children: (close: () => void) => ReactNode`; `MenuItem({ onSelect?, href?, children, tone?: "default" | "danger" })`.
  - `format.ts`: `initialsOf(name: string): string`.
  - `form-kit.tsx`: `INPUT` keeps its name and is the one field style for the whole app.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/format.test.ts` (add `initialsOf` to the file's existing import from `./format`):

```ts
describe("initialsOf", () => {
  it("takes the first letter of the first two words, upper-cased", () => {
    expect(initialsOf("Ayesha Khan")).toBe("AK");
    expect(initialsOf("sample print shop")).toBe("SP");
  });

  it("takes two letters of a single word", () => {
    expect(initialsOf("Ali")).toBe("AL");
    expect(initialsOf("X")).toBe("X");
  });

  it("ignores padding and repeated spaces", () => {
    expect(initialsOf("  Bilal   Ahmed  ")).toBe("BA");
  });

  it("keeps non-Latin letters whole instead of splitting them", () => {
    expect(initialsOf("علی حسن")).toBe("عح");
  });

  it("never returns an empty string", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
```

Create `src/components/ui.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Segmented } from "@/components/segmented";
import { Tabs } from "@/components/tabs";
import { Avatar, Button, Pill } from "@/components/ui";

describe("Button", () => {
  it("draws the primary action in inverse ink, which flips with the theme", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "primary", children: "Save" }),
    );
    expect(html).toContain("bg-inv");
    expect(html).toContain("text-inv-ink");
    expect(html).not.toContain("text-white");
    expect(html).not.toContain("bg-accent");
  });

  it("keeps white text only on the danger fill", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "danger", children: "Delete" }),
    );
    expect(html).toContain("bg-danger");
    expect(html).toContain("text-white");
  });

  it("stays a plain button by default and submits only when asked", () => {
    expect(renderToStaticMarkup(createElement(Button, { children: "Go" }))).toContain(
      'type="button"',
    );
    expect(
      renderToStaticMarkup(createElement(Button, { type: "submit", children: "Go" })),
    ).toContain('type="submit"');
  });
});

describe("Pill", () => {
  it("always carries its text, not colour alone", () => {
    const html = renderToStaticMarkup(createElement(Pill, { tone: "danger", children: "Blocked" }));
    expect(html).toContain("Blocked");
    expect(html).toContain("text-danger-fg");
  });
});

describe("Segmented", () => {
  it("marks exactly the chosen option as pressed", () => {
    const html = renderToStaticMarkup(
      createElement(Segmented<"a" | "b">, {
        value: "b",
        onChange: () => undefined,
        ariaLabel: "Pick",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>B</);
  });
});

describe("Tabs", () => {
  const items = [
    { id: "all", label: "All", count: 41 },
    { id: "attention", label: "Needs attention", count: 3, emphasis: true },
  ];

  it("marks the active tab as the current page and shows counts", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { items, activeId: "attention", ariaLabel: "Order groups" }),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(">41<");
    expect(html).toContain(">3<");
  });

  it("marks nothing when no tab is active", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { items, activeId: null, ariaLabel: "Order groups" }),
    );
    expect(html).not.toContain('aria-current="page"');
  });
});

describe("Avatar", () => {
  it("shows initials and hides them from assistive tech (the name is beside it)", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { name: "Ayesha Khan" }));
    expect(html).toContain(">AK<");
    expect(html).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/ui.test.ts src/lib/format.test.ts`
Expected: FAIL (`initialsOf` is not exported; `@/components/segmented` not found).

- [ ] **Step 3: Add `initialsOf` to `src/lib/format.ts`**

```ts
/** Up to two initials for an avatar: the first letter of the first two words,
 * or the first two letters of a single word. `Array.from` keeps a non-Latin
 * letter (or an emoji) whole instead of cutting a surrogate pair. Never empty. */
export function initialsOf(name: string): string {
  const [first, second] = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (first === undefined) {
    return "?";
  }
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [...Array.from(first).slice(0, 1), ...Array.from(second).slice(0, 1)];
  return letters.join("").toUpperCase();
}
```

- [ ] **Step 4: Create `src/components/segmented.tsx`**

```tsx
import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** For an option whose label is only an icon. */
  ariaLabel?: string;
}

/** A few mutually exclusive choices side by side (reporting period, theme,
 * workspace). Each is a real button with `aria-pressed`, so it reads as a
 * toggle group rather than as tabs. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel: string;
  className?: string;
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex gap-0.5 rounded-[10px] bg-panel-2 p-[3px] ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-[30px] flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm font-medium whitespace-nowrap max-sm:min-h-10 ${
              active ? "bg-panel text-ink shadow-panel" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/tabs.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  /** With `href` the tab is a link (its own URL); without, a button calling `onSelect`. */
  href?: string;
  /** A caution dot before the label: this group needs a person. */
  emphasis?: boolean;
}

/** The underlined tab row used above lists and dashboards. One tab at most is
 * `aria-current="page"`; pass `activeId={null}` while a search replaces the groups. */
export function Tabs({
  items,
  activeId,
  onSelect,
  ariaLabel,
  className = "mb-4",
}: {
  items: ReadonlyArray<TabItem>;
  activeId: string | null;
  onSelect?: (id: string) => void;
  ariaLabel: string;
  className?: string;
}): ReactNode {
  return (
    <nav
      aria-label={ariaLabel}
      className={`flex gap-1 overflow-x-auto border-b border-line ${className}`}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        const look = `-mb-px inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap max-sm:min-h-11 ${
          active
            ? "border-ink font-semibold text-ink"
            : "border-transparent font-medium text-muted hover:text-ink"
        }`;
        const body = (
          <>
            {item.emphasis === true && (
              <span aria-hidden="true" className="size-2 rounded-full bg-caution" />
            )}
            {item.label}
            {item.count !== undefined && (
              <span
                className={`min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums ${
                  active ? "bg-inv text-inv-ink" : "bg-panel-2 text-muted"
                }`}
              >
                {item.count}
              </span>
            )}
          </>
        );
        return item.href !== undefined ? (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={look}
          >
            {body}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect?.(item.id)}
            className={look}
          >
            {body}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Create `src/components/menu.tsx`**

> **Superseded during execution (review of this task, 2026-10-13).** The code below uses the ARIA menu pattern without its keyboard behaviour. The component as built is a non-modal dialog popover instead: the trigger gets `aria-haspopup="dialog"` and `aria-controls`, the popover is `role="dialog"`, focus moves into it on open, Escape and choosing an item return focus to the trigger, and an outside click or focus leaving closes it without moving focus. `MenuItem` has no `role="menuitem"`. `Tabs` (Step 5) likewise ended up with the scroll wrapper outside the bordered row, and button tabs use `aria-current="true"`. The working tree and the ledger are authoritative.

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that opens a small popover of actions (business switcher, account
 * menu). Closes on Escape, on a click outside and after an item is chosen,
 * and gives focus back to the button that opened it. */
export function Menu({
  label,
  trigger,
  children,
  align = "start",
  side = "bottom",
  className = "",
}: {
  /** Names the popover for assistive tech. */
  label: string;
  /** Renders the opening button; spread `props` onto it. */
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLElement>("button, a")?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={`relative ${className}`}>
      {trigger({
        onClick: () => setOpen((value) => !value),
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute z-40 min-w-60 rounded-lg border border-line bg-panel p-1 shadow-xl ${
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
          } ${align === "start" ? "left-0" : "right-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  href,
  children,
  tone = "default",
}: {
  onSelect?: () => void;
  href?: string;
  children: ReactNode;
  tone?: "default" | "danger";
}): ReactNode {
  const look = `flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-panel-2 max-sm:min-h-11 ${
    tone === "danger" ? "text-danger-fg" : "text-ink"
  }`;
  return href !== undefined ? (
    <Link href={href} role="menuitem" onClick={onSelect} className={look}>
      {children}
    </Link>
  ) : (
    <button type="button" role="menuitem" onClick={onSelect} className={look}>
      {children}
    </button>
  );
}
```

- [ ] **Step 7: Restyle `src/components/ui.tsx`**

Keep every export, prop and piece of logic. Change only the class strings below, and add the four new components.

Tone maps (replace the bodies):

```tsx
const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-panel-2 text-ink-2",
  good: "bg-good-soft text-good-fg",
  caution: "bg-caution-soft text-caution-fg",
  danger: "bg-danger-soft text-danger-fg",
  accent: "bg-accent-soft text-accent-fg",
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-line",
  good: "border-good/40",
  caution: "border-caution/40",
  danger: "border-danger/40",
  accent: "border-accent/40",
};
```

`TONE_DOT` and `TONE_TEXT` stay as they are. Add next to them:

```tsx
/** Data marks (bars, meters) are ink unless a status tone is asked for:
 * colour is reserved for status, and "accent" was only ever the default. */
function markFill(tone: Tone | undefined): string {
  return tone === undefined || tone === "accent" ? "bg-inv" : TONE_DOT[tone];
}
```

Per component, the new classes:

| Component        | Element      | New `className`                                                                                                                          |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`     | `header`     | `mb-6 flex flex-wrap items-end justify-between gap-3`                                                                                    |
|                  | `h1`         | `text-2xl leading-[30px] font-semibold tracking-[-0.02em]`                                                                               |
| `Panel`          | `section`    | `` `min-w-0 rounded-lg border ${border} bg-panel shadow-panel ${className}` ``                                                           |
|                  | title row    | `flex items-center justify-between gap-2 border-b border-line px-4 py-3.5`                                                               |
|                  | `h2`         | `text-sm font-semibold`                                                                                                                  |
| `Pill`           | outer `span` | `` `inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_PILL[tone]}` `` (no border) |
|                  | dot          | `size-1.5 rounded-full bg-current`                                                                                                       |
| `Stat`           | `shell`      | `rounded-lg border border-line bg-panel px-4 py-4 shadow-panel`                                                                          |
|                  | `dt`         | `flex items-center gap-1.5 text-[13px] text-muted` (no `uppercase`, no `tracking-wide`); render the dot only when `tone !== "neutral"`   |
|                  | value `dd`   | `` `mt-1.5 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] tabular-nums ${TONE_TEXT[tone]}` `` (drop `num`)                  |
|                  | hint `dd`    | `mt-1 text-xs text-muted`                                                                                                                |
|                  | link variant | `` `${shell} block hover:border-line-strong` ``                                                                                          |
| `EmptyState`     | outer        | `rounded-lg border border-dashed border-line-strong bg-panel px-6 py-12 text-center`                                                     |
| `ForbiddenState` | outer        | `rounded-lg border border-line bg-panel px-6 py-12 text-center`                                                                          |
| `ErrorState`     | outer        | `rounded-lg border border-danger/40 bg-danger-soft px-6 py-8`                                                                            |
| `StaleBanner`    | outer        | `mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-caution/40 bg-caution-soft px-3 py-2`                   |
| `BarList`        | track        | `h-2 overflow-hidden rounded-full bg-panel-2`                                                                                            |
|                  | fill         | `` `block h-full rounded-full ${markFill(row.tone)}` ``                                                                                  |
| `Meter`          | track        | `h-2 overflow-hidden rounded-full bg-panel-2`                                                                                            |
|                  | fill         | `` `h-full rounded-full ${markFill(tone)}` ``                                                                                            |
| `DataTable`      | head `tr`    | `border-y border-line bg-panel-2 text-xs text-muted` (no `uppercase`, no `tracking-wide`)                                                |
|                  | `th`         | `` `px-4 py-2.5 font-medium whitespace-nowrap ${right ? "text-right" : ""}` ``                                                           |

`LiveStatus`: its Refresh button becomes `<Button size="sm" ...>`.

Replace `Button` with:

```tsx
const BUTTON_VARIANT = {
  primary: "border-transparent bg-inv text-inv-ink hover:opacity-90",
  secondary: "border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
  ghost: "border-transparent bg-transparent text-ink hover:bg-panel-2",
  danger: "border-transparent bg-danger text-white hover:opacity-90",
} as const;

const BUTTON_SIZE = {
  sm: "min-h-8 px-2.5 text-[13px] max-sm:min-h-10",
  md: "min-h-9 px-3 text-sm max-sm:min-h-11",
} as const;

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  size = "md",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  type?: "button" | "submit";
  className?: string;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
```

Add at the end of the file (add `import { formatAge, initialsOf } from "@/lib/format";` to the existing format import):

```tsx
/** A square button holding only an icon. `label` is what a screen reader says. */
export function IconButton({
  label,
  onClick,
  href,
  children,
  className = "",
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const look = `relative grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2 max-sm:size-11 ${className}`;
  return href !== undefined ? (
    <Link href={href} aria-label={label} className={look}>
      {children}
    </Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={look}>
      {children}
    </button>
  );
}

/** Initials in a tile. Decorative: the name is always printed beside it. */
export function Avatar({
  name,
  size = "md",
  tone = "soft",
  round = false,
}: {
  name: string;
  size?: "sm" | "md";
  tone?: "inv" | "soft";
  round?: boolean;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center text-xs font-semibold ${
        size === "sm" ? "size-7" : "size-[30px]"
      } ${round ? "rounded-full" : "rounded-md"} ${
        tone === "inv" ? "bg-inv text-inv-ink" : "bg-panel-2 text-ink"
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="rounded border border-line bg-panel-2 px-1.5 font-mono text-[11px] leading-[18px] text-muted">
      {children}
    </kbd>
  );
}

/** The row above a list: search first, then filters, then actions. Wraps on a phone. */
export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={`mb-4 flex flex-wrap items-end gap-2 ${className}`}>{children}</div>;
}
```

- [ ] **Step 8: Restyle `src/components/form-kit.tsx`**

```tsx
export const INPUT =
  "min-h-9 rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm font-normal text-ink placeholder:text-muted hover:border-line-strong max-sm:min-h-11 max-sm:text-base";
```

(16px text on a phone stops iOS zooming into a focused field.)

- `Field` label: `grid gap-1.5 text-sm font-medium`.
- `CheckField` checkbox: `mt-0.5 size-4 accent-inv`.
- `SearchForm` and the filter labels inside it: `grid min-w-[14rem] flex-1 gap-1.5 text-xs font-medium text-muted`; its input keeps `` `${INPUT} text-ink` `` (drop the separate `text-base`).
- `ErrorBanner`: `mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-danger-fg`.
- `Pager`: unchanged apart from inheriting the new `Button`.

- [ ] **Step 9: Restyle `src/components/modal.tsx`**

- `dialog` class: `m-auto w-[34rem] max-w-[94vw] rounded-lg border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 max-sm:mx-0 max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[90vh] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0` (centred from `sm` up, a bottom sheet below it).
- title row: `border-b border-line px-5 py-4`; `h2`: `text-base font-semibold tracking-tight`.
- `FormDialog` footer: `flex justify-end gap-2 border-t border-line px-5 py-3 max-sm:flex-col-reverse`.
- `FormDialog` submit: replace the hand-built `<button>` with
  `<Button type="submit" variant={submitTone === "danger" ? "danger" : "primary"} disabled={busy || disabled}>{busy ? "Working…" : submitLabel}</Button>`.

- [ ] **Step 10: Run the tests and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/ui.test.ts src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 11: Verify the task**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes. If an existing component test asserted an old class string, read the test: update it only when it pinned styling, never when it pinned behaviour or copy.

- [ ] **Step 12: Leave the work uncommitted** and report the files changed and the exact command results.

---

### Task 3: Sweep hard-coded colours, hand-built controls and the interim shell

After Tasks 1 and 2 most screens are already in the new identity. This task fixes the places that bypass the tokens or the kit, so nothing is unreadable in either theme. The shell and the sign-in pages get a minimal fix here; their real redesign is Phase 2 and Phase 3.

**Files:**

- Create: `src/lib/colour-guard.test.ts`
- Modify: `src/components/console-shell.tsx`, `src/components/notification-bell.tsx`, `src/components/dashboard/dashboard-tabs.tsx`, `src/components/dashboard/owner-dashboard.tsx`, `src/components/notifications/notification-centre.tsx`, `src/components/orders/orders-screen.tsx`, `src/components/orders/delivery-panel.tsx`, `src/components/orders/action-bars.tsx`, `src/components/orders/action-dialogs.tsx`, `src/components/printers/printer-detail.tsx`, `src/components/printers/printers-screen.tsx`, `src/components/products/products-screen.tsx`, `src/components/reports/reports-screen.tsx`, `src/components/admin/review-proof-dialog.tsx`, `src/components/admin/business-detail.tsx`, `src/components/admin/user-detail.tsx`, `src/components/admin/shop-qr-code.tsx`, `src/app/login/page.tsx`, `src/app/accept-invite/page.tsx`, `src/app/set-up-account/page.tsx`, and any other file the guard test names.

**Interfaces:**

- Consumes (Task 1): `useTheme()` from `@/components/theme-provider`. (Task 2): `Button` with `variant`/`size`/`className`, `Segmented`, `Tabs`, `IconButton`, `INPUT`.
- Produces: nothing new for later tasks; the guard test keeps the rules true from here on.

- [ ] **Step 1: Write the failing guard test**

Create `src/lib/colour-guard.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Every line of every component that matches `pattern`, as "file:line: text". */
function offenders(pattern: RegExp, allowed: (line: string, file: string) => boolean): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const name = relative(SRC, file).replace(/\\/g, "/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line) && !allowed(line, name)) {
          found.push(`${name}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

describe("colour rules that keep both themes readable", () => {
  it("uses white text only on the danger fill (white on an inverse or accent fill vanishes in dark)", () => {
    expect(offenders(/\btext-white\b/, (line) => /\bbg-danger\b/.test(line))).toEqual([]);
  });

  it("never fills a control with the accent colour (primary actions are bg-inv)", () => {
    // Status marks stay allowed: a tone-map entry (`accent: "bg-accent"`) or a small dot.
    expect(
      offenders(
        /\bbg-accent\b(?!-)/,
        (line) => /accent:\s*"bg-accent"/.test(line) || /\bsize-(1\.5|2)\b/.test(line),
      ),
    ).toEqual([]);
  });

  it("uses the text-safe accent for accent-coloured text", () => {
    expect(offenders(/\btext-accent\b(?!-)/, () => false)).toEqual([]);
  });

  it("keeps literal white and black to the QR code and backdrops", () => {
    expect(
      offenders(
        /\bbg-(white|black)\b/,
        (line, file) =>
          file.endsWith("shop-qr-code.tsx") || /backdrop:bg-black|bg-black\/\d+/.test(line),
      ),
    ).toEqual([]);
  });

  it("has no hand-written field style (every input uses INPUT from form-kit)", () => {
    expect(offenders(/const (FIELD|SELECT)\b[^=]*=\s*"/, () => false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/colour-guard.test.ts`
Expected: FAIL, listing roughly 40 lines. That list is this task's worklist.

- [ ] **Step 3: Fix each kind of offender**

Apply these rules; the guard test's output tells you where.

1. **Hand-built primary buttons** (`rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50` in `delivery-panel.tsx`, `printer-detail.tsx`; the submit buttons in the three auth pages): replace the `<button>` with `<Button variant="primary" ...>`, keeping `type`, `disabled`, `onClick`, the children and any `suppressHydrationWarning` (if the button carries `suppressHydrationWarning`, keep a plain `<button>` and give it the classes `inline-flex min-h-11 items-center justify-center rounded-md bg-inv px-4 font-semibold text-inv-ink hover:opacity-90 disabled:opacity-60` instead, because `Button` does not forward that prop). Auth-page submit buttons are full width: add `className="w-full min-h-11"` or the class list above with `w-full`.
2. **Hand-built segmented controls** (`PeriodPicker` in `owner-dashboard.tsx`; the read/unread switch in `notification-centre.tsx`): render `<Segmented value=... onChange=... options=... ariaLabel=... />` with the same options and the same `aria-label` the group had.
3. **Hand-built tab rows** (`DashboardTabs` in `dashboard-tabs.tsx`, the group tabs in `orders-screen.tsx`, the tabs in `products-screen.tsx`): render `<Tabs>`. `DashboardTabs` passes `href` per item and `activeId={pathname}` with `id: tab.href`. `orders-screen.tsx` passes `activeId={searching ? null : (query.group ?? "all")}`, an `"all"` item first, `emphasis: true` on `needsAttention`, and an `onSelect` that does exactly what the old `onClick`s did; delete the now-unused `GroupTab`. Keep each `aria-label`.
4. **Selected-option highlights** (`border-accent bg-accent-soft` in `review-proof-dialog.tsx`, `reports-screen.tsx`): selected becomes `border-ink bg-panel-2 text-ink`. The highlight ring in `action-bars.tsx` becomes `border-ink ring-2 ring-ink/15`. `hover:border-accent` anywhere becomes `hover:border-line-strong`.
5. **Unread notification row** (`notification-centre.tsx`): `bg-accent-soft` becomes `bg-panel-2`, and the unread dot `bg-accent` becomes `bg-inv`.
6. **Accent text** (`text-accent` used as a text colour, about six files): becomes `text-accent-fg`.
7. **Field styles**: delete each local `const FIELD = "..."` and use `INPUT` imported from `@/components/form-kit` (`orders-screen.tsx`, `action-dialogs.tsx`, `delivery-panel.tsx`, `printer-detail.tsx`, `printers-screen.tsx`, `reports-screen.tsx`, and the two auth pages, where it is `` `${INPUT} min-h-11 text-base` ``). In `login/page.tsx` the two inputs use the same `` `${INPUT} min-h-11 text-base` `` and keep `suppressHydrationWarning`.
8. **Uppercase tracked labels** (`business-detail.tsx`, `user-detail.tsx`): replace `text-xs ... tracking-wide ... uppercase` label classes with `text-xs font-medium text-muted`.
9. **Info notes** (`border-accent/40 bg-accent-soft`): leave them; that is the info tint and it is theme-safe.
10. **`shop-qr-code.tsx`**: leave `bg-white` and add the comment `{/* A QR code needs a white quiet zone to scan, in either theme. */}` above that element.
11. **`notification-bell.tsx`**: the link's classes become `relative grid size-9 place-items-center rounded-md border border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2 max-sm:size-11`. The badge keeps `bg-danger ... text-white`.

- [ ] **Step 4: Make the current shell and the sign-in pages theme-safe**

`src/components/console-shell.tsx` (it is replaced in Phase 2; change only this):

- nav link classes: active `bg-inv font-semibold text-inv-ink`, idle `text-side-ink hover:bg-panel-2 hover:text-ink`; delete the left accent bar `<span>` and the link's `relative`.
- brand link: `text-white` becomes `text-ink`; the logo tile `bg-accent` becomes `bg-inv text-inv-ink`; the small "Business" caption becomes `block text-[11px] text-muted` (no `uppercase`, no `tracking-widest`).
- the drawer scrim `bg-black/50` stays.
- add the theme control to the top bar, immediately before `{topBarExtras}`:

```tsx
<Segmented
  value={resolved}
  onChange={setTheme}
  ariaLabel="Theme"
  options={[
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ]}
/>
```

with `const { resolved, setTheme } = useTheme();` at the top of `ConsoleShell`, and imports for `Segmented` and `useTheme`.

`src/app/login/page.tsx`, `accept-invite/page.tsx`, `set-up-account/page.tsx`:

- the brand panel in `login/page.tsx` (`bg-side ... text-side-ink`) becomes `bg-inv ... text-inv-ink/70`; inside it `text-white` becomes `text-inv-ink`, the logo tile becomes `bg-inv-ink text-inv`, and `text-side-ink` / `text-side-ink/70` become `text-inv-ink/70`; the footer line loses `uppercase` and `tracking-widest`.
- every other logo tile (`bg-accent font-bold text-white`) becomes `bg-inv font-bold text-inv-ink`.
- error banners `border-danger` become `border-danger/40`.
- links `text-accent` become `text-accent-fg`.

- [ ] **Step 5: Run the guard test and confirm it passes**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/colour-guard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the phase**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0 (remove imports that became unused).
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes.
- `timeout 900 node node_modules/next/dist/bin/next build` Expected: "Compiled successfully" and a route table. Routes are now dynamic (`ƒ`) because the root layout reads a cookie; that is intended.

- [ ] **Step 7: Leave the work uncommitted** and report the files changed and the exact command results.
