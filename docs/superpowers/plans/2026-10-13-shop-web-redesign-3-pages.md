# Business Console Redesign, Phase 3 (Page Layouts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the console's pages shared structure: one notice and one back link everywhere, one frame for the three sign-in pages, lists that become cards on a phone, and detail pages with a main column and a reference column.

**Architecture:** Phases 1 and 2 changed what every screen is made of (tokens, kit, frame) without editing the screens. This phase edits screens, but only by moving existing content into shared pieces added to the kit; each sweep is pinned by a rule in the source-scanning guard test, so it stays done. No screen's data, actions or permissions change.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS 4, jest + ts-jest (`*.test.ts`, components rendered with `createElement` + `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-13-shop-web-console-redesign-design.md`

**Depends on:** Phases 1 and 2 being in the working tree.

## Global Constraints

- Edit only files under `apps/shop-web/`.
- **Do not `git add`, `git commit`, `git stash`, `git checkout --`, `git restore` or `git clean` anything.** The working tree is shared with other sessions and holds their uncommitted work. Leave your own work uncommitted.
- **Never kill a process you did not start. Do not start a dev server.** A dev server owned by the controller may be running on port 3012; leave it.
- No API, permission, route or behaviour changes. Every `onClick`, `onSubmit`, `disabled`, `type`, `href`, `role`, `aria-*`, `id`, permission check and piece of copy a screen has today, it still has afterwards. This phase moves and wraps; it does not rewrite.
- Copy says "Business", never "Shop".
- Colour comes only from token utilities; `src/lib/colour-guard.test.ts` must keep passing.
- The project compiles with `noUncheckedIndexedAccess`: read `array[i]` into a local and check it, or use `?.`; never `!`.
- Run every command from `apps/shop-web`, through the binaries directly, under `timeout`:
  - typecheck: `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit`
  - lint: `timeout 300 node ../../node_modules/eslint/bin/eslint.js .`
  - tests: `timeout 600 node ../../node_modules/jest/bin/jest.js`
  - one test file: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/ui.test.ts`
  - build: `timeout 900 node node_modules/next/dist/bin/next build`
- Tests are `*.test.ts` (no JSX). A component whose `children` prop is required takes `children` inside the props object of `createElement`; such a file starts with the same `eslint-disable react/no-children-prop` comment `ui.test.ts` has.
- Match the surrounding code: explicit `: ReactNode` return types, double quotes, doc comments that say why, no new dependencies.
- Write files containing backslashes with the Write/Edit tools, never through a Python or shell script.

## Review Focus

1. A notice that used to be announced (`role="alert"`) silently losing its role, or a quiet one gaining it, when it moves to the shared component. `Notice` passes `role` through and adds none of its own. Pinned in Task 1 (`ui.test.ts`).
2. The dark theme's sign-in page: the brand panel must stay dark, not flip to white. Pinned in Task 1 (`globals.test.ts` checks the brand pair in both themes; the dark brand must be a dark colour).
3. A list turned into phone cards losing its table meaning for a screen reader, or a value appearing with no label. `Row` and `Cell` carry explicit roles and `data-label`. Pinned in Task 2 (`ui.test.ts`).
4. A table that did not opt in changing at all. Pinned in Task 2 (`ui.test.ts`: without `stackOnPhone` the markup has no roles and keeps `min-w-[32rem]`).
5. A panel dropped or duplicated while a detail page is rearranged into two columns. Pinned in Task 3 (`detail-layout.test.ts` counts each screen's panels and sections in source against the numbers recorded before the change).

---

### Task 1: Notice, back link, sign-in frame, and their sweeps

**Files:**

- Modify: `src/app/globals.css`, `src/app/globals.test.ts`
- Modify: `src/components/ui.tsx`, `src/components/ui.test.ts`, `src/components/form-kit.tsx`, `src/components/modal.tsx`
- Create: `src/components/auth-frame.tsx`, `src/components/auth-frame.test.ts`
- Modify: `src/app/login/page.tsx`, `src/app/accept-invite/page.tsx`, `src/app/set-up-account/page.tsx`
- Modify: `src/lib/colour-guard.test.ts`
- Modify: every screen the two new guard rules name (about 30 notices and 8 back links)

**Interfaces:**

- Consumes: `Tone` (already imported in `ui.tsx`), `Link` (already imported in `ui.tsx`).
- Produces, from `@/components/ui`:
  - `Notice({ tone?, role?, children, className? })`, `tone: "neutral" | "good" | "caution" | "danger" | "accent"` (default `"accent"`), `role?: "alert" | "status" | "note"`
  - `BackLink({ href, children })`
  - `DetailGrid({ main, aside })` (used in Task 3)
- Produces, from `@/components/auth-frame`: `AuthFrame({ title, intro, children, footer? })`
- Produces Tailwind utilities `bg-brand`, `text-brand`, `bg-brand-ink`, `text-brand-ink`.

- [ ] **Step 1: Write the failing tests**

In `src/app/globals.test.ts`, add `["--brand-ink", "--brand"]` as the last entry of `TEXT_ON`, and add inside the `describe`:

```ts
it("keeps the sign-in brand panel dark in both themes", () => {
  expect(luminance(token(LIGHT, "--brand"))).toBeLessThan(0.05);
  expect(luminance(token(DARK_BY_SETTING, "--brand"))).toBeLessThan(0.05);
});
```

(`token(block, name)` is the helper already in that file that reads one variable and throws if it is missing. If the file's helper has a different name, use that one.)

Append to `src/components/ui.test.ts` (add `BackLink`, `DetailGrid`, `Notice` to its import from `@/components/ui`):

```ts
describe("Notice", () => {
  it("adds no role of its own, so a quiet message is never announced by accident", () => {
    const html = renderToStaticMarkup(
      createElement(Notice, { tone: "danger", children: "Could not save." }),
    );
    expect(html).toContain("Could not save.");
    expect(html).not.toContain("role=");
    expect(html).toContain("bg-danger-soft");
  });

  it("passes through the role it is given", () => {
    for (const role of ["alert", "status", "note"] as const) {
      const html = renderToStaticMarkup(createElement(Notice, { role, children: "x" }));
      expect(html).toContain(`role="${role}"`);
    }
  });

  it("keeps the caller's layout classes", () => {
    const html = renderToStaticMarkup(
      createElement(Notice, { tone: "good", className: "mb-3 flex", children: "x" }),
    );
    expect(html).toContain("mb-3 flex");
    expect(html).toContain("bg-good-soft");
  });
});

describe("BackLink", () => {
  it("is a link to the parent screen, named by its text", () => {
    const html = renderToStaticMarkup(
      createElement(BackLink, { href: "/orders", children: "Orders" }),
    );
    expect(html).toContain('href="/orders"');
    expect(html).toContain("Orders");
    expect(html).not.toContain("←");
  });
});

describe("DetailGrid", () => {
  it("renders the main column before the reference column, so a phone reads main first", () => {
    const html = renderToStaticMarkup(
      createElement(DetailGrid, { main: "MAIN-PART", aside: "ASIDE-PART" }),
    );
    expect(html.indexOf("MAIN-PART")).toBeGreaterThan(-1);
    expect(html.indexOf("MAIN-PART")).toBeLessThan(html.indexOf("ASIDE-PART"));
  });
});
```

Create `src/components/auth-frame.test.ts`:

```ts
/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required. Same as ui.test.ts. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthFrame } from "@/components/auth-frame";

describe("AuthFrame", () => {
  const html = renderToStaticMarkup(
    createElement(AuthFrame, {
      title: "Sign in to your business",
      intro: "For business owners, managers and staff.",
      footer: "FOOTER-LINKS",
      children: "THE-FORM",
    }),
  );

  it("gives the page one heading, the intro, the form and the footer", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Sign in to your business");
    expect(html).toContain("For business owners, managers and staff.");
    expect(html).toContain("THE-FORM");
    expect(html).toContain("FOOTER-LINKS");
  });

  it("hides the decorative brand panel from assistive tech and paints it with the brand tokens", () => {
    expect(html).toMatch(/<section[^>]*aria-hidden="true"[^>]*bg-brand/);
  });

  it("omits the footer block when there is none", () => {
    const bare = renderToStaticMarkup(
      createElement(AuthFrame, { title: "T", intro: "I", children: "F" }),
    );
    expect(bare).not.toContain("FOOTER-LINKS");
  });
});
```

Append two cases inside the `describe` of `src/lib/colour-guard.test.ts`:

```ts
it("has no hand-written notice box (use Notice from the kit)", () => {
  // The recipe every hand-written one shares: a soft status fill with px-3 py-2.
  const recipe =
    /\b(danger|caution|good|accent)-soft\b[^"`]*\bpx-3 py-2\b|\bpx-3 py-2\b[^"`]*\b(danger|caution|good|accent)-soft\b/;
  expect(offenders(recipe, (_line, file) => file === "components/ui.tsx")).toEqual([]);
});

it("has no hand-written back arrow (use BackLink from the kit)", () => {
  expect(offenders(/&larr;|←/, (_line, file) => file === "components/ui.tsx")).toEqual([]);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/app/globals.test.ts src/components/ui.test.ts src/components/auth-frame.test.ts src/lib/colour-guard.test.ts`
Expected: FAIL. `--brand` missing; `Notice`/`BackLink`/`DetailGrid` not exported; `auth-frame` not found; the two guard cases list the hand-written notices and back links. Keep that list: it is the sweep's worklist.

- [ ] **Step 3: Add the brand tokens to `src/app/globals.css`**

In the light `:root` block, after `--inv-ink`:

```css
--brand: #0a0a0a;
--brand-ink: #ffffff;
```

In BOTH dark blocks (the one inside the media query and `:root[data-theme="dark"]`), after `--inv-ink`:

```css
--brand: #131313;
--brand-ink: #f5f5f5;
```

In `@theme inline`, after `--color-inv-ink`:

```css
--color-brand: var(--brand);
--color-brand-ink: var(--brand-ink);
```

Add a line to the comment at the top of the file: `inv` flips with the theme (black in light, white in dark); `brand` does not (dark in both), for surfaces such as the sign-in panel that must never turn white.

Also in this file, directly after the `:focus-visible` rule, add:

```css
/* The search palette's box is the only field in its dialog and holds focus
   for as long as the dialog is open, so a ring around it says nothing (the
   browser pass showed a blue rectangle inside the palette's header). Its
   caret shows where typing goes. Opt-in, one use; not for ordinary fields. */
[data-quiet-focus]:focus-visible {
  outline: none;
}
```

and in `src/components/shell/command-palette.tsx` give the palette's `<input>` the attribute `data-quiet-focus`.

- [ ] **Step 4: Add `Notice`, `BackLink` and `DetailGrid` to `src/components/ui.tsx`**

```tsx
const NOTICE_TONE: Record<Tone, string> = {
  neutral: "border-line bg-panel-2 text-ink",
  good: "border-good/40 bg-good-soft text-ink",
  caution: "border-caution/40 bg-caution-soft text-ink",
  danger: "border-danger/40 bg-danger-soft text-danger-fg",
  accent: "border-accent/40 bg-accent-soft text-ink",
};

/** A tinted message box: something failed (danger), needs care (caution),
 * worked (good), or is worth knowing (accent). It sets no ARIA role itself:
 * whether a message interrupts a screen reader (`alert`), is read politely
 * (`status`) or is just there (`note`, or nothing) is the caller's decision,
 * and a box that guessed would start announcing messages that were quiet. */
export function Notice({
  tone = "accent",
  role,
  children,
  className = "",
}: {
  tone?: Tone;
  role?: "alert" | "status" | "note";
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      role={role}
      className={`rounded-md border px-3 py-2 text-sm ${NOTICE_TONE[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

/** The way back from a detail page to its list. */
export function BackLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted hover:text-ink max-sm:min-h-11"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {children}
    </Link>
  );
}

/** A detail page's two columns from `lg` up: the working area, and a narrower
 * column of reference facts beside it. One column below `lg`, main first. */
export function DetailGrid({ main, aside }: { main: ReactNode; aside: ReactNode }): ReactNode {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid min-w-0 gap-4">{main}</div>
      <div className="grid min-w-0 gap-4">{aside}</div>
    </div>
  );
}
```

- [ ] **Step 5: Use `Notice` inside the kit**

- `src/components/form-kit.tsx`, `ErrorBanner`: its `<p role="alert" className="mb-4 ...">` becomes `<Notice tone="danger" role="alert" className="mb-4">{message}</Notice>` (import `Notice` from `@/components/ui`).
- `src/components/modal.tsx`, `FormDialog`'s error paragraph becomes `<Notice tone="danger" role="alert" className="mx-5 mb-3">{error}</Notice>`.
- `src/components/ui.tsx`, `StaleBanner`: becomes a `Notice tone="caution" role="status"` with `className="mb-4 flex flex-wrap items-center justify-between gap-2"` and the same two children.

- [ ] **Step 6: Create `src/components/auth-frame.tsx`**

```tsx
import type { ReactNode } from "react";

/** The frame shared by the three signed-out pages (sign in, set up account,
 * accept invitation): a brand panel beside the form from `lg` up, the form
 * alone below it. The panel uses the `brand` tokens, which stay dark in both
 * themes; with `inv` it turned white in dark mode and lit up most of the
 * screen. It is decoration, so it is hidden from assistive tech. */
export function AuthFrame({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: ReactNode;
  /** The form. */
  children: ReactNode;
  /** Links to the other signed-out pages. */
  footer?: ReactNode;
}): ReactNode {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <section
        aria-hidden="true"
        className="hidden flex-col justify-between border-r border-line bg-brand p-12 text-brand-ink/70 lg:flex"
      >
        <div className="flex items-center gap-3 text-brand-ink">
          <span className="grid size-9 place-items-center rounded-md bg-brand-ink text-sm font-bold text-brand">
            PA
          </span>
          <span className="text-lg font-semibold tracking-tight">Print Automated</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-brand-ink">
            The whole floor, on one screen.
          </p>
          <p className="mt-4 text-base">
            Orders, printers, paper and people, with the things that need a human called out first.
          </p>
        </div>
        <p className="num text-xs">Queue &middot; Printers &middot; Stock &middot; Reports</p>
      </section>

      <section className="flex flex-col justify-center gap-6 px-6 py-12 sm:px-12">
        <span className="grid size-9 place-items-center rounded-md bg-inv text-sm font-bold text-inv-ink lg:hidden">
          PA
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">{intro}</p>
        </div>
        {children}
        {footer !== undefined && (
          <div className="flex flex-col gap-2 text-sm text-muted">{footer}</div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Put the three sign-in pages in the frame**

In each of `src/app/login/page.tsx`, `src/app/accept-invite/page.tsx`, `src/app/set-up-account/page.tsx`, replace the page's outer `<main>` layout (and, in `login`, the brand `<section>` and the small logo) with `<AuthFrame title=... intro=... footer=...>`:

- `title` is the page's current `<h1>` text; `intro` is the current paragraph under it (in `login` that is the `expired ? ... : ...` expression); the `<h1>` and that paragraph are then removed from the page, since the frame renders them.
- `children` is the page's `<form>` exactly as it is now: every input, `suppressHydrationWarning`, handler, `autoComplete`, the error element and the submit button unchanged.
- `footer` is the page's current block of links to the other signed-out pages, if it has one (without its wrapping `div`; the frame supplies it).
- The error element in each form becomes `<Notice tone="danger" role="alert">{error}</Notice>`.
- Nothing above the `return` changes.

- [ ] **Step 8: Sweep the hand-written notices and back links**

Work through the list the two guard cases printed.

Notices. An element whose `className` holds a soft status fill with `px-3 py-2` becomes a `Notice`:

- `tone` from the fill: `danger-soft` → `"danger"`, `caution-soft` → `"caution"`, `good-soft` → `"good"`, `accent-soft` → `"accent"`.
- `role`: exactly the element's current `role` (`alert`, `status` or `note`); if it has none, pass none.
- `className`: only what is left after removing the recipe (`rounded-md border border-*/NN bg-*-soft px-3 py-2`, `text-sm`, and for danger `text-danger-fg`): margins, `flex`/`grid` layout, `text-xs` if it had it.
- Children, and any `id` or `aria-*` (pass `aria-*`/`id` by wrapping only if `Notice` cannot take them: if one of the elements has such an attribute, stop and report it rather than dropping it).
- If the element has a soft fill but is not a message box (for example a selectable card or a table row), leave it and say so in your report; if the guard still names it, report NEEDS_CONTEXT with the line.

Back links. `<p className="mb-3 text-sm"><Link href="X" className="underline ...">&larr; Label</Link></p>` becomes `<BackLink href="X">Label</BackLink>`. There are eight (orders, printers, inventory item, supplier, purchase order, business, user, printer rules). Remove the `Link` import where it becomes unused.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/app/globals.test.ts src/components/ui.test.ts src/components/auth-frame.test.ts src/lib/colour-guard.test.ts`
Expected: PASS.

- [ ] **Step 10: Verify the task**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes. Some existing tests assert on rendered screens: if one fails because a notice is now a `div` instead of a `p`, the test pinned markup, and you update it; if it fails on text, role or presence, you broke behaviour, and you fix the screen.
- `timeout 900 node node_modules/next/dist/bin/next build` Expected: "Compiled successfully".

- [ ] **Step 11: Leave the work uncommitted** and report the files changed, every element you left alone and why, and the exact command results.

---

### Task 2: Lists become cards on a phone

**Files:**

- Modify: `src/app/globals.css`
- Modify: `src/components/ui.tsx`, `src/components/ui.test.ts`
- Modify: `src/components/customers/customers-screen.tsx`, `src/components/suppliers/suppliers-screen.tsx`, `src/components/staff/staff-screen.tsx`, `src/components/products/products-screen.tsx`, `src/components/purchase-orders/po-screen.tsx`, `src/components/inventory/inventory-screen.tsx`, `src/components/admin/businesses-screen.tsx`, `src/components/admin/users-screen.tsx`, `src/components/admin/payments-screen.tsx`
- Modify: `src/components/orders/orders-screen.tsx`

**Interfaces:**

- Consumes: `DataTable`, `Panel` in `ui.tsx`.
- Produces, from `@/components/ui`:
  - `DataTable` gains `stackOnPhone?: boolean`
  - `Row({ children, className? })`, `Cell({ label?, children, className?, colSpan? })`
  - `Panel` gains `flushOnPhone?: boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/ui.test.ts` (add `Cell`, `DataTable`, `Panel`, `Row` to its import):

```ts
describe("DataTable", () => {
  const rows = createElement(Row, {
    children: [
      createElement(Cell, { key: "a", children: "Ayesha Khan" }),
      createElement(Cell, { key: "b", label: "Phone", children: "0300 0000000" }),
    ],
  });

  it("changes nothing for a table that does not opt in", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, { caption: "People", head: ["Name", "Phone"], children: null }),
    );
    expect(html).toContain("min-w-[32rem]");
    expect(html).not.toContain("stack-sm");
    expect(html).not.toContain('role="table"');
  });

  it("keeps table roles on an opted-in table, because its phone layout stops being display:table", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        caption: "People",
        head: ["Name", "Phone"],
        stackOnPhone: true,
        children: rows,
      }),
    );
    expect(html).toContain("stack-sm");
    expect(html).toContain('role="table"');
    expect(html.match(/role="rowgroup"/g)).toHaveLength(2);
    expect(html.match(/role="columnheader"/g)).toHaveLength(2);
    expect(html.match(/role="row"/g)).toHaveLength(2);
    expect(html.match(/role="cell"/g)).toHaveLength(2);
  });

  it("labels a value cell for its phone card and leaves the title cell unlabelled", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        caption: "People",
        head: ["Name", "Phone"],
        stackOnPhone: true,
        children: rows,
      }),
    );
    expect(html).toContain('data-label="Phone"');
    expect(html.match(/data-label=/g)).toHaveLength(1);
  });
});

describe("Panel", () => {
  it("drops its own box on a phone only when asked, so phone cards are not boxed twice", () => {
    const plain = renderToStaticMarkup(createElement(Panel, { children: "x" }));
    const flush = renderToStaticMarkup(createElement(Panel, { flushOnPhone: true, children: "x" }));
    expect(plain).not.toContain("max-sm:border-0");
    expect(flush).toContain("max-sm:border-0");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/ui.test.ts`
Expected: FAIL, `Row` / `Cell` are not exported.

- [ ] **Step 3: Extend the kit in `src/components/ui.tsx`**

`Panel`: add the prop `flushOnPhone = false` (`flushOnPhone?: boolean`, documented as "On a phone, drop the panel's own border, fill and padding; for a panel whose table turns into cards there"). When it is true, append to the `section` classes `max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none`, to the title row `max-sm:border-0 max-sm:px-0`, and to the body `div` `max-sm:p-0`.

`DataTable`: add `stackOnPhone = false`. With it false, the markup is exactly what it is today. With it true:

- wrapper `div`: `sm:-mx-4 sm:overflow-x-auto` (no negative margin or scrolling on a phone);
- `table`: `role="table"`, class `stack-sm w-full text-left text-sm sm:min-w-[32rem]`;
- `thead` and `tbody`: `role="rowgroup"`; the head `tr`: `role="row"`; each `th`: `role="columnheader"`.

Document the prop: "On a phone, show each row as a card of label and value instead of a sideways-scrolling table. Rows must then be built with `Row` and `Cell`."

Add:

```tsx
/** A row of a `stackOnPhone` table. On a phone the row is laid out as a card,
 * which stops it being a table row for assistive tech unless it says so. */
export function Row({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <tr role="row" className={className}>
      {children}
    </tr>
  );
}

/** A cell of a `stackOnPhone` table. `label` is the column's heading, printed
 * beside the value on a phone. Leave it out for the row's title (the first
 * cell) and for a cell that holds only actions. */
export function Cell({
  label,
  children,
  className = "",
  colSpan,
}: {
  label?: string;
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}): ReactNode {
  return (
    <td role="cell" data-label={label} colSpan={colSpan} className={`px-4 py-2 ${className}`}>
      {children}
    </td>
  );
}
```

- [ ] **Step 4: Add the phone layout to `src/app/globals.css`**

Append before the `@keyframes shimmer` rule:

```css
/* DataTable stackOnPhone: below `sm`, each row is a card and each cell a
   "label ..... value" line (the label is the cell's data-label). The column
   headings stay in the DOM, visually hidden, and Row/Cell carry explicit
   roles, so it is still a table to a screen reader. */
@media (max-width: 639.98px) {
  table.stack-sm,
  table.stack-sm tbody,
  table.stack-sm tr,
  table.stack-sm td {
    display: block;
  }
  table.stack-sm thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  table.stack-sm tbody {
    display: grid;
    gap: 0.5rem;
  }
  table.stack-sm tbody > tr {
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    background: var(--panel);
    box-shadow: var(--panel-shadow);
    padding: 0.625rem 0.875rem;
  }
  table.stack-sm td {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.25rem 0;
    text-align: right;
    white-space: normal;
  }
  table.stack-sm td[data-label]::before {
    content: attr(data-label);
    flex: none;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 500;
    text-align: left;
  }
  table.stack-sm td:not([data-label]) {
    justify-content: flex-start;
    text-align: left;
  }
  table.stack-sm td:not([data-label]):first-child {
    font-size: 0.9375rem;
    font-weight: 600;
  }
  table.stack-sm td:not([data-label]):last-child:not(:first-child) {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.25rem;
    padding-top: 0.5rem;
  }
  table.stack-sm td:empty {
    display: none;
  }
}
```

- [ ] **Step 5: Run the kit tests and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/ui.test.ts src/app/globals.test.ts`
Expected: PASS.

- [ ] **Step 6: Opt the main lists in**

For the main list table of each of the nine screens in **Files** (in `staff-screen.tsx`, both tables):

- `<DataTable ... stackOnPhone>`;
- its wrapping `<Panel>` gets `flushOnPhone`;
- each `<tr key=...>` becomes `<Row key=...>` (keep any `className`);
- each `<td className="px-4 py-2 ...">` becomes `<Cell className="...">` with `px-4 py-2` removed from the class list (the cell adds it); a `<td>` with `colSpan` passes it;
- the first cell of a row (the name or number that identifies it) gets no `label`; a cell that holds only buttons or links (usually the last) gets no `label`; every other cell gets `label="<that column's text in the head array>"`. If the head text for an action column is `""`, that cell has no label.
- A table inside a dialog, or a small secondary table, stays as it is.

Nothing inside the cells changes.

- [ ] **Step 7: Collapse the orders filters on a phone**

In `src/components/orders/orders-screen.tsx`, the search form shows seven controls at once, which fills a phone screen before the first order. Keep the search box and the Search button always visible; put the other fields (Status, Payment, From, To, Priority, the Clear button, the "More filters" toggle and the `showMore` row) in a block that is always shown from `sm` up and, below `sm`, only when a new `filtersOpen` state is true:

- `const [filtersOpen, setFiltersOpen] = useState(isSearching(query));`
- a phone-only toggle beside the Search button: `<Button onClick={() => setFiltersOpen(!filtersOpen)} className="sm:hidden">{filtersOpen ? "Hide filters" : "Filters"}</Button>`, on a real `<button>` with `aria-expanded={filtersOpen}` (if `Button` cannot take `aria-expanded`, use a plain `<button type="button">` with the classes `inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-3 text-sm font-medium sm:hidden`);
- the block's wrapper: ``className={`${filtersOpen ? "flex" : "hidden"} flex-wrap items-end gap-3 sm:flex`}``.

The form's `onSubmit`, every field's `value`/`onChange`, and the URL behaviour are unchanged.

- [ ] **Step 8: Verify the task**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes.
- `timeout 900 node node_modules/next/dist/bin/next build` Expected: "Compiled successfully".

- [ ] **Step 9: Leave the work uncommitted** and report, per screen, which table you opted in and which cells got which labels, plus the exact command results.

---

### Task 3: Detail pages get a main column and a reference column

**Files:**

- Create: `src/lib/detail-layout.test.ts`
- Modify: `src/components/orders/order-detail.tsx`, `src/components/printers/printer-detail.tsx`, `src/components/inventory/inventory-item-screen.tsx`, `src/components/suppliers/supplier-detail.tsx`, `src/components/purchase-orders/po-detail.tsx`, `src/components/admin/business-detail.tsx`, `src/components/admin/user-detail.tsx`

**Interfaces:**

- Consumes: `DetailGrid({ main, aside })` from `@/components/ui` (Task 1).
- Produces: nothing for later tasks.

- [ ] **Step 1: Record what each screen contains, as a test**

Before changing any screen, count in each of the seven files the occurrences of `<Panel` and of `<StatGrid`, and write them into `src/lib/detail-layout.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = join(__dirname, "..", "components");

function count(file: string, needle: string): number {
  return readFileSync(join(COMPONENTS, file), "utf8").split(needle).length - 1;
}

/** [file, <Panel count, <StatGrid count] as they were before the two-column
 * layout. Rearranging a detail page must move its sections, never drop or
 * duplicate one; a deliberate change to a screen's sections updates its row. */
const SCREENS: ReadonlyArray<[string, number, number]> = [
  ["orders/order-detail.tsx", 0, 0],
  ["printers/printer-detail.tsx", 0, 0],
  ["inventory/inventory-item-screen.tsx", 0, 0],
  ["suppliers/supplier-detail.tsx", 0, 0],
  ["purchase-orders/po-detail.tsx", 0, 0],
  ["admin/business-detail.tsx", 0, 0],
  ["admin/user-detail.tsx", 0, 0],
];

describe("detail pages", () => {
  it.each(SCREENS)("%s keeps its %i panels and %i stat grids", (file, panels, statGrids) => {
    expect(count(file, "<Panel")).toBe(panels);
    expect(count(file, "<StatGrid")).toBe(statGrids);
  });

  it.each(SCREENS)("%s lays its sections out with DetailGrid", (file) => {
    expect(count(file, "<DetailGrid")).toBeGreaterThanOrEqual(1);
  });
});
```

Replace each `0, 0` with the two numbers you counted. Run `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/detail-layout.test.ts`: the seven "keeps its panels" cases must PASS (they describe today) and the seven "lays out with DetailGrid" cases must FAIL. Record that output.

- [ ] **Step 2: Rearrange each screen**

In each screen, the sections currently stacked in one `grid gap-4` column go into `<DetailGrid main={<>...</>} aside={<>...</>} />`, in the assignment below. A section is moved whole: the JSX of a panel (or of the component that renders it) is cut from the stack and pasted into `main` or `aside` unchanged, in the order listed. Anything listed under "full width" stays above the grid where it is. Dialogs and other elements that render nothing in the flow stay where they are, after the grid.

| Screen                                | Full width, above the grid                           | `main` (in order)                                                                                                          | `aside` (in order)                                              |
| ------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `orders/order-detail.tsx`             | nothing                                              | the first panel (status pills, error, action bar, reprint note); `OrderItems`; the "Print jobs" panel; `OrderHistoryPanel` | `OrderSummary`; `DeliveryPanel`                                 |
| `printers/printer-detail.tsx`         | the `StatGrid`                                       | "Current job"; "Availability and rules"; "Capabilities"; "Page limit"                                                      | "Maintenance" (when shown); "Profile"; the remove-printer block |
| `inventory/inventory-item-screen.tsx` | the `StatGrid`                                       | the movements panel; `SuppliersOfItem`                                                                                     | "Details"                                                       |
| `suppliers/supplier-detail.tsx`       | nothing                                              | the panel listing what the supplier provides (the one with the table)                                                      | the supplier's details panel                                    |
| `purchase-orders/po-detail.tsx`       | the first panel (status and actions); the `StatGrid` | "Lines"                                                                                                                    | "Payment"                                                       |
| `admin/business-detail.tsx`           | the `StatGrid`                                       | "Profile"; the owner panel; the plan panel                                                                                 | "Status"; the QR code                                           |
| `admin/user-detail.tsx`               | nothing                                              | "Profile"; "Role"                                                                                                          | "Status"                                                        |

Rules:

- If a screen's sections are produced by more than one component (for example a body component that renders some panels and its parent that renders others), put the `DetailGrid` where all the sections it needs are in scope; pass a section down or lift it up only as far as needed, without changing its props.
- A section that lands in `aside` is 22rem wide from `lg` up. If it lays its contents out in columns (`sm:grid-cols-2`, `lg:grid-cols-3`, `sm:grid-cols-3` on a `dl` or a field grid), add `lg:grid-cols-1` so it is one column there. `OrderSummary`'s `dl` is one of these. Change no other class.
- The existing `grid gap-4 lg:grid-cols-2` arrangement inside `printer-detail.tsx`, if its panels are now split between `main` and `aside`, is removed along with its wrapper.
- A panel shown conditionally keeps its condition.
- If a screen's real structure does not fit its row (a named section does not exist, or a section is not listed), do not improvise: place what does fit, leave the rest full width above the grid, and say exactly what you found in your report.

- [ ] **Step 3: Run the layout test and confirm it passes**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/detail-layout.test.ts`
Expected: PASS, 14 cases, with the counts you recorded in Step 1 untouched.

- [ ] **Step 4: Verify the phase**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes.
- `timeout 900 node node_modules/next/dist/bin/next build` Expected: "Compiled successfully".

- [ ] **Step 5: Leave the work uncommitted** and report, per screen, what went into `main`, `aside` and full width, any `lg:grid-cols-1` you added, anything that did not fit its row, and the exact command results.
