# Customer Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/customer-web` (home page, "For print shops", and the four-step QR ordering flow) the monochrome light/dark look of the redesigned shop-web, phone first, without changing any behaviour.

**Architecture:** Copy shop-web's theme tokens, fonts and the few kit pieces this app needs into customer-web (the apps deploy separately; nothing is shared through a package). Add a small kit in `src/components/ui.tsx`, restyle the two static pages, and split the 637-line QR page into one file per step under `src/components/qr/` with its logic unchanged.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS 4.3, jest + ts-jest (`*.test.ts`; components rendered with `createElement` + `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-15-customer-web-redesign-design.md`

## Global Constraints

- Edit only files under `apps/customer-web/`. Read anything else (shop-web is the reference you copy from), change nothing else.
- **Do not `git add`, `git commit`, `git stash`, `git checkout --`, `git restore` or `git clean` anything.** The working tree is shared and holds other sessions' uncommitted work in shop-web and shop-mobile; leave it alone. `apps/customer-web/src/app/layout.tsx` and `apps/customer-web/tsconfig.json` already carry someone's uncommitted edits: keep the `suppressHydrationWarning` on `<body>`, and do not edit `tsconfig.json`.
- **Never kill a process you did not start. Do not start a dev server.**
- No API, validation, route or behaviour changes. The QR flow keeps its steps, its calls (`runPublicUploadFlow`, `createPublicOrder`), its idempotency key, its validation (`createPublicOrderSchema`, `validatePageSelection`) and its message wording. The existing tests in `src/**/*.test.ts` keep passing unchanged.
- Colour comes only from token utilities (`bg-panel`, `text-muted`, `border-line`, `bg-inv text-inv-ink`, ...). No Tailwind default greys (`gray-*`), no inline `style` colours, no hex in class names, `text-white` only together with `bg-danger`.
- Every class name is a whole token: never glue one to a template hole (`py-3.5${x}` is invisible to Tailwind; write `py-3.5 ${x}`).
- Phone first: below `sm`, controls are at least 44px tall (`max-sm:min-h-11`) and inputs use 16px text.
- The project compiles with `noUncheckedIndexedAccess`: read `array[i]` into a local and check it, or use `?.`; never `!`.
- Tests are `*.test.ts` (no JSX). A component whose `children` prop is required takes `children` inside `createElement`'s props object; such a file starts with `/* eslint-disable react/no-children-prop -- ... */` as shop-web's `ui.test.ts` does.
- Run every command from `apps/customer-web`, through the binaries directly, under `timeout`:
  - typecheck: `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit`
  - lint: `timeout 300 node ../../node_modules/eslint/bin/eslint.js .`
  - tests: `timeout 600 node ../../node_modules/jest/bin/jest.js`
  - one test file: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/ui.test.ts`
  - build: **do not run `next build` here.** A customer-web dev server may be running on port 3001 and serves from `.next`; a build replaces that folder and breaks it. The controller runs the production build in an isolated copy of the app.
- Write files containing backslashes with the Write/Edit tools, never through a Python or shell script.
- Match the surrounding code: explicit `: ReactNode` return types, double quotes, doc comments that say why, no new dependencies.

## Review Focus

1. A step of the QR flow that changes behaviour while being restyled (a lost `required`, a changed input `type`, a radio that no longer updates state, the submit no longer disabled while placing the order). Pinned in Task 2 (`qr-steps.test.ts` renders each step).
2. Text unreadable in one theme. Pinned in Task 1 (the copied `globals.test.ts` checks contrast in both).
3. A class that Tailwind cannot see (glued to a template hole), producing a silently missing style. Pinned in Task 1 (`colour-guard.test.ts`).
4. A phone layout that scrolls sideways, or a "Place order" bar that covers the last field. Checked by the controller's browser pass at 390px and 360px.
5. Default greys or inline colour styles creeping back. Pinned in Task 1 (`colour-guard.test.ts`).

---

### Task 1: Look, kit, frame and the two static pages

**Files:**

- Modify: `jest.config.cjs`
- Modify: `src/app/globals.css` (replace), `src/app/layout.tsx`
- Create: `src/app/globals.test.ts`, `src/app/fonts.ts`, `src/app/fonts/` (copied files)
- Create: `src/components/ui.tsx`, `src/components/ui.test.ts`, `src/lib/colour-guard.test.ts`
- Modify: `src/app/page.tsx`, `src/app/for-shops/page.tsx`

**Interfaces:**

- Produces, from `@/components/ui`: `Button`, `INPUT`, `INPUT_LG`, `Field`, `Notice`, `Card`, `ChoiceGroup`, `ChipToggle`, `Stepper`, `BrandMark`, `SiteFrame` (signatures below); Tailwind tokens `surface`, `panel`, `panel-2`, `ink`, `ink-2`, `muted`, `line`, `line-strong`, `inv`, `inv-ink`, status `*-soft` / `*-fg`, `shadow-panel`.

- [ ] **Step 1: Let jest render components**

Replace `jest.config.cjs` with (the same transform and alias shop-web uses):

```js
const preset = require("../../jest.preset.cjs");

module.exports = {
  ...preset,
  rootDir: ".",
  // The standalone build copies package.json under .next, which jest-haste-map flags as a duplicate.
  modulePathIgnorePatterns: ["<rootDir>/.next"],
  transform: {
    // Same as the preset, plus the automatic JSX runtime so component tests
    // can render real .tsx components to static markup (react-dom/server).
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          verbatimModuleSyntax: false,
          jsx: "react-jsx",
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    // The app's own "@/..." alias (tsconfig paths), which Next resolves itself.
    "^@/(.*)$": "<rootDir>/src/$1",
    ...preset.moduleNameMapper,
  },
};
```

Run the full suite: it must still pass exactly as before (the existing tests are unchanged).

- [ ] **Step 2: Copy the stylesheet test and see it fail**

Copy `apps/shop-web/src/app/globals.test.ts` to `src/app/globals.test.ts` unchanged. Run it: it fails, because customer-web's stylesheet has no theme blocks yet.

- [ ] **Step 3: The stylesheet**

Replace `src/app/globals.css` with, in this order, copied from `apps/shop-web/src/app/globals.css`:

1. `@import "tailwindcss";`
2. the comment above the theme blocks, rewritten to say: these values mirror `apps/shop-web/src/app/globals.css` (keep the two in step); customer-web follows the device's light/dark setting and never sets `data-theme`, so the `[data-theme="dark"]` block is unused here and kept only so this file and its test stay identical in shape to shop-web's;
3. the three theme blocks (`:root { ... }`, the `@media (prefers-color-scheme: dark)` block, `:root[data-theme="dark"] { ... }`), every variable, verbatim;
4. the whole `@theme inline { ... }` block, verbatim;
5. the `html { ... }`, `body { ... }`, `.num { ... }` and `:focus-visible { ... }` rules and the `@layer base { ... }` transition rule, verbatim;
6. the `@media (prefers-reduced-motion: reduce)` block, without its `.skeleton` part (this app has no skeletons).

Do not copy shop-web's `--bottom-nav` block, `[data-quiet-focus]`, `nav[data-tabs]`, `table.stack-sm`, `@keyframes shimmer` or `.skeleton`: nothing here uses them.

Run `src/app/globals.test.ts`: it passes.

- [ ] **Step 4: Fonts and layout**

Copy `apps/shop-web/src/app/fonts/` (both `woff2` files and `OFL.txt`) to `src/app/fonts/`, and `apps/shop-web/src/app/fonts.ts` to `src/app/fonts.ts` unchanged.

`src/app/layout.tsx`: keep the `@/env` import and its comment, the metadata, and the design-tokens `<style>`; import `./fonts` and add ``className={`${geistSans.variable} ${geistMono.variable}`}`` to `<html>`; give `<body>` `className="min-h-screen bg-surface text-ink antialiased"` and keep its `suppressHydrationWarning`; add

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};
```

(importing `Viewport` from `next`). The root layout reads no cookie.

- [ ] **Step 5: Write the failing kit and guard tests**

Create `src/components/ui.test.ts`:

```ts
/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required, so children go in the props object. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ChipToggle, ChoiceGroup, Notice, SiteFrame, Stepper } from "@/components/ui";

describe("Button", () => {
  it("draws the primary action in inverse ink, never accent with white text", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "primary", children: "Continue" }),
    );
    expect(html).toContain("bg-inv");
    expect(html).toContain("text-inv-ink");
    expect(html).not.toContain("text-white");
    expect(html).toContain('type="button"');
  });

  it("submits only when asked, and can fill the width", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { type: "submit", block: true, children: "Place order" }),
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain("w-full");
  });
});

describe("ChoiceGroup", () => {
  const options = [
    { value: "BW", label: "Black & white" },
    { value: "COLOR", label: "Colour" },
  ];

  it("is a real radio group with a legend, so keyboards and screen readers work as before", () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceGroup, {
        legend: "Color",
        name: "color",
        value: "BW",
        options,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain(">Color</legend>");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/name="color"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
});

describe("ChipToggle", () => {
  it("is a real checkbox with its label", () => {
    const html = renderToStaticMarkup(
      createElement(ChipToggle, { label: "Stapling", checked: true, onChange: () => undefined }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain("Stapling");
  });
});

describe("Stepper", () => {
  it("wraps a number input between labelled minus and plus buttons", () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, {
        label: "Copies",
        value: 1,
        min: 1,
        max: 500,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('type="number"');
    expect(html).toContain('aria-label="Fewer copies"');
    expect(html).toContain('aria-label="More copies"');
    // At the minimum, "fewer" cannot go lower.
    expect(html).toMatch(
      /aria-label="Fewer copies"[^>]*disabled=""|disabled=""[^>]*aria-label="Fewer copies"/,
    );
  });
});

describe("Notice", () => {
  it("passes its role through and adds none of its own", () => {
    expect(
      renderToStaticMarkup(createElement(Notice, { tone: "danger", children: "x" })),
    ).not.toContain("role=");
    expect(
      renderToStaticMarkup(createElement(Notice, { tone: "danger", role: "alert", children: "x" })),
    ).toContain('role="alert"');
  });
});

describe("SiteFrame", () => {
  it("has one main landmark and a link home from the brand", () => {
    const html = renderToStaticMarkup(createElement(SiteFrame, { children: "BODY" }));
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain('href="/"');
    expect(html).toContain("BODY");
  });
});
```

Create `src/lib/colour-guard.test.ts`, adapting shop-web's `src/lib/colour-guard.test.ts` (read it): keep its `sourceFiles` and `offenders` helpers (with `SRC` pointing at this app's `src`), and these cases:

```ts
describe("colour rules that keep both themes readable", () => {
  it("uses no Tailwind default greys (they ignore the dark theme)", () => {
    expect(
      offenders(
        /\b(text|bg|border|ring|divide|from|to|via)-(gray|slate|zinc|neutral|stone)-\d/,
        () => false,
      ),
    ).toEqual([]);
  });

  it("sets no colour through inline styles", () => {
    expect(offenders(/style=\{\{[^}]*(color|background|border)/i, () => false)).toEqual([]);
  });

  it("uses white text only on the danger fill", () => {
    expect(offenders(/\btext-white\b/, (line) => /\bbg-danger\b/.test(line))).toEqual([]);
  });

  it("uses no literal black fill and no hex colour in a class", () => {
    expect(offenders(/\bbg-black\b(?!\/)|\[#[0-9a-fA-F]{3,6}\]/, () => false)).toEqual([]);
  });

  it("never glues a class name to a template hole (Tailwind would not generate the class)", () => {
    expect(offenders(/className=\{`[^`]*[\w.\])]\$\{/, () => false)).toEqual([]);
  });
});
```

Run both files: `ui.test.ts` fails (module not found); `colour-guard.test.ts` fails, listing the default greys and inline colour styles in the three pages. That list is this task's and the next task's worklist (Task 2 owns the QR page's offenders; this task must clear only `page.tsx` and `for-shops/page.tsx`, so expect the guard to stay red on `s/[shopId]/upload/page.tsx` until Task 2).

- [ ] **Step 6: The kit, `src/components/ui.tsx`**

Copy these from `apps/shop-web/src/components/ui.tsx` and `form-kit.tsx`, adjusting only imports: the `Tone` type (declare it locally as `"neutral" | "good" | "caution" | "danger" | "accent"`), `Notice` with its tone map and doc comment, and from `form-kit.tsx` the `FIELD_SHAPE`, `INPUT` and `INPUT_LG` constants. Then add:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

const BUTTON_VARIANT = {
  primary: "border-transparent bg-inv text-inv-ink hover:opacity-90",
  secondary: "border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
  ghost: "border-transparent bg-transparent text-ink hover:bg-panel-2",
} as const;

/** The site's one button. Primary is inverse ink (black on light, white on
 * dark). `block` fills the width, which is how the QR flow's main actions
 * look on a phone. */
export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
  block = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANT;
  type?: "button" | "submit";
  block?: boolean;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-5 text-[15px] font-semibold disabled:pointer-events-none disabled:opacity-50 ${BUTTON_VARIANT[variant]} ${block ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

/** A label above its control, with an optional hint or error below. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {error ? (
        <span role="alert" className="text-xs font-normal text-danger-fg">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs font-normal text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** A plain surface for grouping. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={`rounded-lg border border-line bg-panel p-5 shadow-panel ${className}`}>
      {children}
    </div>
  );
}

/** Mutually exclusive print options, drawn as segments. They are real radio
 * inputs (visually hidden inside each segment), so the form, the keyboard
 * (arrow keys move between options) and screen readers behave as they did
 * with the old radio list. */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}): ReactNode {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-[10px] bg-panel-2 p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-10 cursor-pointer items-center justify-center rounded-[7px] px-3 text-center text-sm font-medium text-muted hover:text-ink has-[:checked]:bg-panel has-[:checked]:text-ink has-[:checked]:shadow-panel has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-fg max-sm:min-h-11"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An optional extra (finishing) as a chip. A real checkbox, visually hidden. */
export function ChipToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}): ReactNode {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-medium text-ink hover:border-line-strong has-[:checked]:border-transparent has-[:checked]:bg-inv has-[:checked]:text-inv-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-fg max-sm:min-h-11">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

/** A number with minus and plus buttons around it, for counts like copies.
 * The input stays editable; the buttons clamp to `min`/`max`. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}): ReactNode {
  const noun = label.toLowerCase();
  const step = (delta: number): void => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="inline-flex w-fit items-center rounded-md border border-line bg-panel">
        <button
          type="button"
          aria-label={`Fewer ${noun}`}
          disabled={value <= min}
          onClick={() => step(-1)}
          className="grid size-11 place-items-center text-lg text-ink disabled:opacity-40"
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          className="num h-11 w-16 border-x border-line bg-transparent text-center text-base"
        />
        <button
          type="button"
          aria-label={`More ${noun}`}
          disabled={value >= max}
          onClick={() => step(1)}
          className="grid size-11 place-items-center text-lg text-ink disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** The brand: a logo tile and the name, linking home. */
export function BrandMark(): ReactNode {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-ink">
      <span className="grid size-8 place-items-center rounded-md bg-inv text-xs font-bold text-inv-ink">
        PA
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Print Automated</span>
    </Link>
  );
}

/** Every page's frame: a slim header with the brand, the page, a footer line.
 * `width` is the content column: "narrow" for the QR flow's forms, "wide" for
 * the two information pages. */
export function SiteFrame({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
}): ReactNode {
  const column = width === "narrow" ? "max-w-xl" : "max-w-4xl";
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <div className={`mx-auto flex w-full items-center px-5 py-2 ${column}`}>
          <BrandMark />
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-5 py-8 sm:py-12 ${column}`}>{children}</main>
      <footer className="border-t border-line">
        <p className={`mx-auto w-full px-5 py-5 text-xs text-muted ${column}`}>
          Print Automated · No account, no app to install.
        </p>
      </footer>
    </div>
  );
}
```

Run `ui.test.ts`: it passes. If a check in the test does not match how React renders an attribute (for example the order of `disabled` and `aria-label`), fix the assertion to the rendered form and say so in your report; do not change what is asserted.

- [ ] **Step 7: The home page and "For print shops"**

`src/app/page.tsx` (keep the doc comment; its reasoning still holds):

- `SiteFrame` (wide); a hero: an eyebrow line `No account · No app`, an `h1` "Print from your phone. Collect at the counter." (`text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[1.05]`), and a paragraph in `text-muted` carrying the existing explanation (scan the QR code at your print shop's counter, upload, choose how it is printed, collect it already printed);
- below it, "How it works" as three numbered `Card`s in a grid (`grid gap-3 sm:grid-cols-3`): 1 "Scan the shop's code" (the QR code at the counter opens that shop's own page), 2 "Upload and choose" (your file, pages, copies, colour), 3 "Collect at the counter" (show your order number; pay and pick up). Each card: a 28px ink circle with the number, a `h2` title (`text-base font-semibold`), one line of `text-muted`;
- then a short line "Run a print shop?" with a secondary `Link` styled like `Button` secondary to `/for-shops` labelled "For print shops".

`src/app/for-shops/page.tsx` (keep its doc comment): `SiteFrame` (wide); an `h1` "For print shops"; the existing paragraph; three points as a list of `Card`s or a simple list with ink check marks: "Paid, correctly configured jobs from customers nearby", "Review, accept and print from one queue", "No walk-in USB sticks, no re-typing orders"; the existing sentence that staff sign in from the Print Automated Shop app; a `Link` back to `/` ("Back to Print Automated").

Use token classes only. Both pages must work at 360px without sideways scrolling.

- [ ] **Step 8: Verify**

- `src/lib/colour-guard.test.ts`: every case passes except those naming `src/app/s/[shopId]/upload/page.tsx` (Task 2). Report exactly which lines remain.
- typecheck, lint: exit 0.
- full jest run: every suite passes except `colour-guard.test.ts`, whose only failures are the QR page's lines.
- `next build`: not run (see Global Constraints).

- [ ] **Step 9: Leave the work uncommitted** and report the files changed and the exact command results.

---

### Task 2: The QR ordering flow

**Files:**

- Modify: `src/app/s/[shopId]/upload/page.tsx`
- Create: `src/components/qr/step-indicator.tsx`, `src/components/qr/details-step.tsx`, `src/components/qr/upload-step.tsx`, `src/components/qr/configure-step.tsx`, `src/components/qr/confirmation.tsx`
- Create: `src/components/qr/qr-steps.test.ts`

**Interfaces:**

- Consumes (Task 1): `Button`, `INPUT_LG`, `Field`, `Notice`, `Card`, `ChoiceGroup`, `ChipToggle`, `Stepper`, `SiteFrame` from `@/components/ui`.
- Produces: `StepIndicator({ current }: { current: 1 | 2 | 3 })`; `GuestDetailsStep({ onContinue })`, `UploadStep({ shopId, onReady })`, `ConfigureStep({ step, onSubmit })`, `ConfirmationScreen({ order })` with exactly the props they have today; the `WizardStep` type exported from `configure-step.tsx` (or a small `types.ts` beside it) for the page to use.

- [ ] **Step 1: Write the failing step tests**

Create `src/components/qr/qr-steps.test.ts` (same eslint-disable header as `ui.test.ts`). Render each step to static markup and assert what must not change:

- `GuestDetailsStep` with `onContinue: () => undefined`: an input `type="text"` and an input `type="tel"`, both `required`; the visible labels "Your name" and "Phone number"; a `type="submit"` button "Continue"; and `StepIndicator` text "Your details" marked current (`aria-current="step"`).
- `UploadStep` with a `shopId`: a file input with `accept="application/pdf,image/jpeg,image/png,.docx"`; the text "Choose a file"; the line "PDF, JPEG, PNG, or Word (.docx), up to 25MB."; "Your file" marked current.
- `ConfigureStep` with `step: { name: "configure", documentId: "d1", filename: "Thesis.pdf", pageCount: 12 }`: "Thesis.pdf"; the legends "Pages", "Color", "Sides", "Orientation", "Finishing (optional)"; "All pages (12)"; exactly one checked radio in each of the four groups; the labels "Copies", "Paper size", "Paper type"; a `type="submit"` button "Place order" that is not disabled; "Print options" marked current.
- The same with `step.name: "submitting"`: the button reads "Placing order…" and is `disabled`.
- The same with `step.name: "submit-error"` and `message: "Nope"`: "Nope" inside an element with `role="alert"`.
- `ConfirmationScreen` with a fixture `order` built to the `PublicOrderResult` type from `@/lib/public-order` (order number, shop name, file name, a configuration, two line items, platform fee, total in "PKR"): the order number, the shop name, "Total", the formatted total, and the collection instruction.

Run it: it fails (modules not found).

- [ ] **Step 2: Move each step into its own file, unchanged**

Cut `GuestDetailsStep`, `UploadStep` (with `UploadProgress` and `BUSY_LABELS`), `ConfigureStep` (with `PAPER_SIZES`, `PAPER_TYPES`, `FINISHING_OPTIONS`, `FINISHING_LABELS`) and `ConfirmationScreen` from `page.tsx` into the four files, with their doc comments, exported. Move the `WizardStep` type to where `ConfigureStep` and the page can both import it. `page.tsx` keeps `QrOrderUploadPage`, `QrOrderWizard`, the idempotency key and the state machine, importing the steps. Run typecheck: exit 0. Nothing is restyled yet; the behaviour is byte-for-byte the old one.

- [ ] **Step 3: `StepIndicator`**

```tsx
const STEPS = ["Your details", "Your file", "Print options"] as const;

/** Where the guest is in the flow. The current step is in ink and marked
 * `aria-current="step"`; finished steps are ticked. */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }): ReactNode {
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-medium">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "current" : "next";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className="flex min-w-0 items-center gap-2"
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full ${
                state === "next" ? "border border-line-strong text-muted" : "bg-inv text-inv-ink"
              }`}
            >
              {state === "done" ? "✓" : number}
            </span>
            <span
              className={`truncate ${state === "current" ? "text-ink" : "text-muted"} ${state === "current" ? "" : "max-sm:sr-only"}`}
            >
              {label}
            </span>
            {number < STEPS.length && (
              <span aria-hidden="true" className="h-px w-4 bg-line-strong sm:w-8" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

(On a phone only the current step's name shows; the others are numbers, with their names kept for screen readers.)

- [ ] **Step 4: Restyle each step (logic untouched)**

Every step renders inside `SiteFrame width="narrow"` instead of its own `<main>`.

- **Details**: `StepIndicator current={1}`; `h1` "Print with this shop" (`text-2xl font-semibold tracking-[-0.02em]`) and the existing sentence in `text-muted`; the two fields as `Field` + `<input className={INPUT_LG} ...>` keeping `type`, `value`, `onChange`, `required` (add `autoComplete="name"` and `autoComplete="tel"`, and `inputMode="tel"` on the phone field: hints only, no behaviour change); the error as `Notice tone="danger" role="alert"`; `Button type="submit" variant="primary" block` "Continue".
- **Upload**: `StepIndicator current={2}`; `h1` "Upload your document"; the drop zone as a dashed `rounded-lg border-2 border-dashed` area (`border-line-strong`, and `border-ink bg-panel-2` while dragging) with, when idle, an upload glyph (a 24px stroke SVG, `aria-hidden`), "Drag and drop a file here, or" (hidden below `sm`, where dragging does not happen), the "Choose a file" label styled as a primary block button holding the hidden file input exactly as now, and the accepted-types line in `text-muted`; while busy, the busy label and, when uploading, a progress bar (`role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, a `bg-panel-2` track and a `bg-inv` fill at `width: ${progress}%` set through `style={{ width: ... }}`, which is a size, not a colour) plus the percentage; the rejection and the error as `Notice tone="danger" role="alert"` with the same text.
- **Print options**: `StepIndicator current={3}`; `h1` "Choose print options"; the file name in a `Card` with a document glyph; then, in this order, `ChoiceGroup` "Pages" (All pages (n) | Page range) with the two range inputs (`INPUT`, `aria-label` kept) shown under it when range is chosen and the page error as `Notice tone="danger" role="alert"`; `ChoiceGroup` "Color" (Black & white | Color); `ChoiceGroup` "Sides"; `ChoiceGroup` "Orientation"; `Stepper` "Copies" (min 1, max 500); "Paper size" and "Paper type" as `Field` + `select` (`INPUT_LG`, side by side from `sm`: `grid gap-4 sm:grid-cols-2`); "Finishing (optional)" as a `fieldset` with a legend and `ChipToggle`s in a wrapping row; the submit error as `Notice tone="danger" role="alert"`; the submit button. Every value, setter, label text and option list is the one the old code used (the radio groups become `ChoiceGroup`s with `name`s `pages`, `color`, `sides`, `orientation`).
  On a phone the submit sits in a bar fixed to the bottom: wrap the `Button type="submit" variant="primary" block` in `<div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:border-t max-sm:border-line max-sm:bg-surface/95 max-sm:px-5 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:backdrop-blur">`, and give the form `max-sm:pb-28` so the bar never covers the last field. The button stays inside the `<form>`.
- **Confirmation**: no step indicator. A `Card` with `role="status"` (kept): "Order placed" in `text-muted`, the order number as the `h1` in `num text-3xl font-semibold`, the shop name; a `dl` of Document and Configuration (stacked on a phone, two columns from `sm`); a second `Card` with the line items, the platform fee and the total (the total row `border-t border-line pt-3 text-base font-semibold`, figures `num`); the collection sentence in a `Notice tone="accent"`.

- [ ] **Step 5: Run the step tests and the guard**

`qr-steps.test.ts` passes; `colour-guard.test.ts` now passes completely (no offenders left anywhere).

- [ ] **Step 6: Verify the task**

- typecheck, lint: exit 0.
- full jest run: every suite passes.
- `next build`: not run (see Global Constraints).

- [ ] **Step 7: Leave the work uncommitted** and report: what moved where, every place the markup changed an element (for example a `p` that became a `Notice`), anything you could not do as written, and the exact command results.
