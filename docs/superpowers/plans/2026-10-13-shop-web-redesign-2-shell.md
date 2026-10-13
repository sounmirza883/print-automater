# Business Console Redesign, Phase 2 (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console's frame: a grouped sidebar, a real business switcher, an account menu with the theme setting, a "Search or jump to" palette, and a bottom tab bar on phones in place of the slide-over drawer.

**Architecture:** What the navigation lists stays a pure function of the person's role (`lib/nav.ts`); this phase adds grouping and phone-tab helpers beside it and a pure filter for the palette, each unit-tested. The frame itself is split into small client components under `src/components/shell/`, composed by `console-shell.tsx`, which keeps its export and props so `console-frame.tsx` and every screen are untouched.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS 4, jest + ts-jest (`*.test.ts`, components rendered with `createElement` + `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-13-shop-web-console-redesign-design.md`

**Depends on:** Phase 1 (`2026-10-13-shop-web-redesign-1-foundation.md`) being in the working tree: tokens `inv`, `inv-ink`, `ink-2`, `line-strong`; `Segmented`, `Tabs`, `Menu`, `MenuItem`; `Button`, `IconButton`, `Avatar`, `Kbd`; `useTheme()`.

## Global Constraints

- Edit only files under `apps/shop-web/`.
- **Do not `git add`, `git commit`, `git stash`, `git checkout --`, `git restore` or `git clean` anything.** The working tree is shared with other sessions and holds their uncommitted work. Leave your own work uncommitted.
- **Never kill a process you did not start. Do not start a dev server.**
- No API, permission, route or behaviour changes. `visibleNavItems` and `activeNavItem` keep their behaviour; `ConsoleShell` keeps its name and props (`children`, `topBarExtras`).
- What a person sees in navigation is decided only by `visibleNavItems` (role at the selected business). No component adds or hides an entry by itself.
- Copy says "Business", never "Shop".
- Colour comes only from token utilities. `text-white` only with `bg-danger`; `bg-black/NN` only on a backdrop or scrim. Primary actions and the active nav item are `bg-inv text-inv-ink`. No left-border accent bars.
- Targets are at least 44px tall below `lg` (`min-h-11` / `size-11`).
- Run every command from `apps/shop-web`, through the binaries directly, under `timeout`:
  - typecheck: `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit`
  - lint: `timeout 300 node ../../node_modules/eslint/bin/eslint.js .`
  - tests: `timeout 600 node ../../node_modules/jest/bin/jest.js`
  - one test file: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/nav.test.ts`
  - build: `timeout 900 node node_modules/next/dist/bin/next build`
- Match the surrounding code: explicit `: ReactNode` return types, double quotes, doc comments that say why, no new dependencies.
- The project compiles with `noUncheckedIndexedAccess`: every `array[i]` and `record[key]` read is `T | undefined`. Read into a local and check it, or use `?.`; never silence it with `!`.
- Write files containing backslashes with the Write/Edit tools, never through a Python or shell script.

## Review Focus

1. A path under two nav entries (`/admin/businesses/abc` is under both "Overview" `/admin` and "Businesses" `/admin/businesses`): exactly one entry may be marked current, the more specific one. The old shell marked both. Pinned in Task 2 (`shell.test.ts`).
2. A role that sees one or two screens (counter staff: Orders, Customers): no empty section headings, and the phone bar still works with two tabs plus "More". Pinned in Task 1 (`nav.test.ts`).
3. Palette text with `&`, `=`, `#`, spaces, or over 100 characters: the orders-search link must be encoded and capped, never a broken or injected query string. Pinned in Task 1 (`command-palette.test.ts`).
4. A platform admin, who has no business at all (`business === null`, `memberships` empty): the frame must render without a business switcher instead of crashing. Pinned in Task 2 (`shell.test.ts`).
5. A person who belongs to exactly one business: the switcher must not present itself as a menu with nothing to switch to. Pinned in Task 2 (`shell.test.ts`).

---

### Task 1: Navigation groups, phone tabs and palette filtering (logic)

**Files:**

- Modify: `src/lib/nav.ts`, `src/lib/nav.test.ts`
- Create: `src/lib/command-palette.ts`, `src/lib/command-palette.test.ts`

**Interfaces:**

- Consumes: the existing `NavItem`, `NAV_ITEMS`, `visibleNavItems`, `activeNavItem` in `src/lib/nav.ts`.
- Produces, from `@/lib/nav`:
  - `type NavGroupId = "overview" | "production" | "stock" | "catalogue" | "business" | "platform"`
  - `NavItem` gains `group: NavGroupId`
  - `NAV_GROUPS: ReadonlyArray<{ id: NavGroupId; label: string | null }>`
  - `interface NavGroupView { id: NavGroupId; label: string | null; items: NavItem[] }`
  - `groupedNav(items: readonly NavItem[]): NavGroupView[]`
  - `interface BottomTab { id: string; href: string; label: string }`
  - `bottomTabs(items: readonly NavItem[]): BottomTab[]`
- Produces, from `@/lib/command-palette`:
  - `interface PaletteEntry { id: string; label: string; href: string; hint: string }`
  - `paletteEntries(query: string, items: readonly NavItem[], canSearchOrders: boolean): PaletteEntry[]`

- [ ] **Step 1: Write the failing navigation tests**

In `src/lib/nav.test.ts`, change the import line to

```ts
import {
  activeNavItem,
  bottomTabs,
  groupedNav,
  visibleNavItems,
  NAV_GROUPS,
  NAV_ITEMS,
  type NavItem,
} from "./nav";
```

and append:

```ts
function visibleFor(userRole: UserRole, businessRole: UserRole | null): NavItem[] {
  return visibleNavItems({
    userRole,
    businessRole,
    permissions: new Set(businessRole ? serverPermissionsFor(businessRole) : []),
  });
}

function shape(items: NavItem[]): Array<[string | null, string[]]> {
  return groupedNav(items).map((group) => [group.label, group.items.map((item) => item.id)]);
}

describe("groupedNav", () => {
  it("arranges an owner's screens under the business headings, in order", () => {
    expect(shape(visibleFor(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER))).toEqual([
      [null, ["dashboard", "notifications"]],
      ["Production", ["orders", "printers", "customers"]],
      ["Stock", ["inventory", "suppliers", "purchase-orders"]],
      ["Catalogue", ["products"]],
      ["Business", ["staff", "reports", "settings", "billing"]],
    ]);
  });

  it("drops a heading when the role sees none of its screens", () => {
    expect(shape(visibleFor(UserRole.SHOP_COUNTER, UserRole.SHOP_COUNTER))).toEqual([
      [null, ["notifications"]],
      ["Production", ["orders", "customers"]],
    ]);
  });

  it("gives a platform admin the Platform heading and nothing business-scoped", () => {
    expect(shape(visibleFor(UserRole.ADMIN, null))).toEqual([
      [null, ["notifications"]],
      [
        "Platform",
        [
          "admin",
          "admin-businesses",
          "admin-users",
          "admin-plans",
          "admin-payments",
          "admin-reports",
        ],
      ],
    ]);
  });

  it("puts every nav item in exactly one known group", () => {
    const known = NAV_GROUPS.map((group) => group.id);
    for (const item of NAV_ITEMS) {
      expect(known).toContain(item.group);
    }
    expect(groupedNav(NAV_ITEMS).flatMap((group) => group.items)).toHaveLength(NAV_ITEMS.length);
  });

  it("is empty when there is nothing to show", () => {
    expect(groupedNav([])).toEqual([]);
  });
});

describe("bottomTabs", () => {
  it("gives an owner the four busiest screens under short labels", () => {
    expect(bottomTabs(visibleFor(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER))).toEqual([
      { id: "dashboard", href: "/dashboard", label: "Home" },
      { id: "orders", href: "/orders", label: "Orders" },
      { id: "printers", href: "/printers", label: "Printers" },
      { id: "inventory", href: "/inventory", label: "Stock" },
    ]);
  });

  it("fills only from what the role can see, even if that is two tabs", () => {
    expect(
      bottomTabs(visibleFor(UserRole.SHOP_COUNTER, UserRole.SHOP_COUNTER)).map((tab) => tab.id),
    ).toEqual(["orders", "customers"]);
  });

  it("gives a platform admin the platform screens", () => {
    expect(bottomTabs(visibleFor(UserRole.ADMIN, null)).map((tab) => tab.id)).toEqual([
      "admin",
      "admin-businesses",
      "admin-payments",
      "admin-users",
    ]);
  });

  it("never returns more than four, and nothing for nothing", () => {
    expect(bottomTabs(NAV_ITEMS)).toHaveLength(4);
    expect(bottomTabs([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/nav.test.ts`
Expected: FAIL, `groupedNav` / `bottomTabs` / `NAV_GROUPS` are not exported.

- [ ] **Step 3: Implement groups and phone tabs in `src/lib/nav.ts`**

Add above `NavItem`:

```ts
/** The sidebar section an entry sits under. */
export type NavGroupId =
  "overview" | "production" | "stock" | "catalogue" | "business" | "platform";
```

Add to `NavItem`, after `scope`:

```ts
/** Which sidebar section lists it. */
group: NavGroupId;
```

Add `group` to every entry of `NAV_ITEMS`, and change two labels. Do not reorder the array (tests and the within-section order depend on it):

| `id`                                                                                | `group`      | label change                                                              |
| ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `dashboard`                                                                         | `overview`   |                                                                           |
| `orders`                                                                            | `production` | `"Orders / Queue"` becomes `"Orders & queue"`                             |
| `printers`                                                                          | `production` |                                                                           |
| `inventory`                                                                         | `stock`      |                                                                           |
| `suppliers`                                                                         | `stock`      |                                                                           |
| `purchase-orders`                                                                   | `stock`      |                                                                           |
| `products`                                                                          | `catalogue`  |                                                                           |
| `customers`                                                                         | `production` |                                                                           |
| `staff`                                                                             | `business`   |                                                                           |
| `reports`                                                                           | `business`   |                                                                           |
| `settings`                                                                          | `business`   |                                                                           |
| `billing`                                                                           | `business`   |                                                                           |
| `notifications`                                                                     | `overview`   |                                                                           |
| `admin`                                                                             | `platform`   | `"Platform"` becomes `"Overview"` (the section heading now says Platform) |
| `admin-businesses`, `admin-users`, `admin-plans`, `admin-payments`, `admin-reports` | `platform`   |                                                                           |

Append at the end of the file:

```ts
/** The sidebar's sections, in display order. `label: null` is the unlabelled
 * first section. */
export const NAV_GROUPS: ReadonlyArray<{ id: NavGroupId; label: string | null }> = [
  { id: "overview", label: null },
  { id: "production", label: "Production" },
  { id: "stock", label: "Stock" },
  { id: "catalogue", label: "Catalogue" },
  { id: "business", label: "Business" },
  { id: "platform", label: "Platform" },
];

export interface NavGroupView {
  id: NavGroupId;
  label: string | null;
  items: NavItem[];
}

/** The given (already permission-filtered) items arranged into sections.
 * A section with nothing in it is dropped, so no role sees an empty heading. */
export function groupedNav(items: readonly NavItem[]): NavGroupView[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);
}

export interface BottomTab {
  id: string;
  href: string;
  /** Short enough for a phone tab ("Orders & queue" does not fit). */
  label: string;
}

/** Candidates for the phone's bottom bar, most used first. */
const BOTTOM_TAB_ORDER: ReadonlyArray<{ id: string; label: string }> = [
  { id: "dashboard", label: "Home" },
  { id: "orders", label: "Orders" },
  { id: "printers", label: "Printers" },
  { id: "inventory", label: "Stock" },
  { id: "customers", label: "Customers" },
  { id: "admin", label: "Overview" },
  { id: "admin-businesses", label: "Businesses" },
  { id: "admin-payments", label: "Payments" },
  { id: "admin-users", label: "Users" },
];

const BOTTOM_TAB_LIMIT = 4;

/** Up to four tabs for the phone's bottom bar, taken in priority order from
 * what this role can see. Everything else is reached through "More". */
export function bottomTabs(items: readonly NavItem[]): BottomTab[] {
  const tabs: BottomTab[] = [];
  for (const candidate of BOTTOM_TAB_ORDER) {
    const item = items.find((entry) => entry.id === candidate.id);
    if (item !== undefined && tabs.length < BOTTOM_TAB_LIMIT) {
      tabs.push({ id: item.id, href: item.href, label: candidate.label });
    }
  }
  return tabs;
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/nav.test.ts`
Expected: PASS, the pre-existing cases plus 9 new ones.

- [ ] **Step 5: Write the failing palette tests**

Create `src/lib/command-palette.test.ts`:

```ts
import { paletteEntries } from "./command-palette";
import type { NavItem } from "./nav";

function item(id: string, label: string, blurb: string): NavItem {
  return { id, label, href: `/${id}`, scope: "business", group: "production", anyOf: [], blurb };
}

const ITEMS: NavItem[] = [
  item("orders", "Orders & queue", "The production queue."),
  item("printers", "Printers", "Register printers."),
  item("purchase-orders", "Purchase orders", "Restock orders and receiving."),
  item("reports", "Reports", "Revenue and printing volume."),
];

function ids(query: string, canSearchOrders = false): string[] {
  return paletteEntries(query, ITEMS, canSearchOrders).map((entry) => entry.id);
}

describe("paletteEntries", () => {
  it("lists every screen, in navigation order, before anything is typed", () => {
    expect(ids("")).toEqual(["orders", "printers", "purchase-orders", "reports"]);
    expect(ids("   ", true)).toEqual(["orders", "printers", "purchase-orders", "reports"]);
  });

  it("carries the screen's link and its one-line description", () => {
    expect(paletteEntries("", ITEMS, false)[1]).toEqual({
      id: "printers",
      label: "Printers",
      href: "/printers",
      hint: "Register printers.",
    });
  });

  it("puts screens whose name starts with the text first, then other matches", () => {
    expect(ids("p")).toEqual(["printers", "purchase-orders", "orders", "reports"]);
  });

  it("matches without regard to case, in the name or the description", () => {
    expect(ids("ORD")).toEqual(["orders", "purchase-orders"]);
    expect(ids("revenue")).toEqual(["reports"]);
  });

  it("offers an orders search last, so a typed screen name still lands on the screen", () => {
    const entries = paletteEntries("  ord ", ITEMS, true);
    expect(entries.map((entry) => entry.id)).toEqual([
      "orders",
      "purchase-orders",
      "search-orders",
    ]);
    expect(entries[2]).toEqual({
      id: "search-orders",
      label: 'Search orders for "ord"',
      href: "/orders?q=ord",
      hint: "Order number, customer or document",
    });
  });

  it("offers only the orders search when no screen matches", () => {
    expect(ids("PA-10482", true)).toEqual(["search-orders"]);
  });

  it("offers nothing when no screen matches and the role cannot search orders", () => {
    expect(ids("PA-10482", false)).toEqual([]);
  });

  it("encodes the typed text into the link", () => {
    const entries = paletteEntries("a&b=c #1", ITEMS, true);
    expect(entries[entries.length - 1]?.href).toBe("/orders?q=a%26b%3Dc%20%231");
  });

  it("caps the search text at the 100 characters the orders search accepts", () => {
    const entries = paletteEntries("x".repeat(150), ITEMS, true);
    expect(entries[entries.length - 1]?.href).toBe(`/orders?q=${"x".repeat(100)}`);
  });
});
```

- [ ] **Step 6: Run them and confirm they fail**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/command-palette.test.ts`
Expected: FAIL, "Cannot find module './command-palette'".

- [ ] **Step 7: Implement `src/lib/command-palette.ts`**

```ts
import type { NavItem } from "@/lib/nav";

export interface PaletteEntry {
  id: string;
  label: string;
  href: string;
  /** One muted line under the label. */
  hint: string;
}

/** The orders search box and the API both stop at 100 characters. */
const MAX_QUERY = 100;

/** What "Search or jump to" lists for the text typed so far.
 *
 * `items` are the screens this person may open (already permission-filtered).
 * Screens whose name starts with the text come first, then screens that
 * mention it anywhere in their name or description. With `canSearchOrders`,
 * typed text also offers an orders search, LAST: typing "printers" should land
 * on Printers, and when no screen matches the search is the only row, so Enter
 * runs it. */
export function paletteEntries(
  query: string,
  items: readonly NavItem[],
  canSearchOrders: boolean,
): PaletteEntry[] {
  const text = query.trim().slice(0, MAX_QUERY);
  const needle = text.toLowerCase();
  const screens: PaletteEntry[] = items.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    hint: item.blurb,
  }));
  if (needle === "") {
    return screens;
  }
  const startsWith = (entry: PaletteEntry): boolean => entry.label.toLowerCase().startsWith(needle);
  const mentions = (entry: PaletteEntry): boolean =>
    entry.label.toLowerCase().includes(needle) || entry.hint.toLowerCase().includes(needle);
  const matches = [
    ...screens.filter(startsWith),
    ...screens.filter((entry) => !startsWith(entry) && mentions(entry)),
  ];
  if (!canSearchOrders) {
    return matches;
  }
  return [
    ...matches,
    {
      id: "search-orders",
      label: `Search orders for "${text}"`,
      href: `/orders?q=${encodeURIComponent(text)}`,
      hint: "Order number, customer or document",
    },
  ];
}
```

- [ ] **Step 8: Run them and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/lib/command-palette.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 9: Verify the task**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0. (If any other file builds a `NavItem` literal without `group`, add the right group there.)
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes.

- [ ] **Step 10: Leave the work uncommitted** and report the files changed and the exact command results.

---

### Task 2: The new frame

**Files:**

- Create: `src/components/shell/icons.tsx`, `src/components/shell/nav-list.tsx`, `src/components/shell/business-switcher.tsx`, `src/components/shell/account-menu.tsx`, `src/components/shell/command-palette.tsx`, `src/components/shell/bottom-tabs.tsx`
- Create: `src/components/shell/shell.test.ts`
- Modify: `src/components/console-shell.tsx` (rewrite; same export and props)

**Interfaces:**

- Consumes (Task 1): `groupedNav`, `bottomTabs`, `paletteEntries`, `PaletteEntry`. (Phase 1): `Menu`, `MenuItem` from `@/components/menu`; `Segmented` from `@/components/segmented`; `Avatar`, `Kbd` from `@/components/ui`; `Modal` from `@/components/modal`; `useTheme` from `@/components/theme-provider`. (Existing): `useSession`, `SessionContext` from `@/components/session-provider`; `visibleNavItems`, `activeNavItem` from `@/lib/nav`; `roleLabel` from `@/lib/permissions`; `PlanBanner` from `@/components/plan-banner`; `Permission` from `@print-automated/types`.
- Produces: `ConsoleShell({ children, topBarExtras })` unchanged for `console-frame.tsx`; `NavIcon`, `Icon` from `@/components/shell/icons`; `NavList({ onNavigate? })`; `BusinessSwitcher({ compact? })`; `AccountMenu({ placement })`; `CommandPalette()`; `BottomTabs()`.

- [ ] **Step 1: Write the failing frame tests**

Create `src/components/shell/shell.test.ts`:

```ts
/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required, so children go in the props object. Same as ui.test.ts. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserRole } from "@print-automated/types";
import { ConsoleShell } from "@/components/console-shell";
import { SessionContext } from "@/components/session-provider";
import { BusinessSwitcher } from "@/components/shell/business-switcher";
import { NavList } from "@/components/shell/nav-list";
import { renderAs } from "@/components/test-session";
import { ThemeProvider } from "@/components/theme-provider";

let mockPathname = "/orders/abc";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function themed(node: ReactNode): ReactNode {
  return createElement(ThemeProvider, { initial: "system", children: node });
}

/** The anchors marked as the current page. */
function currentLinks(html: string): string[] {
  return html.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
}

/** A platform admin: no business at all. `renderAs` always supplies one, so build the session by hand. */
function renderAsPlatformAdmin(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(SessionContext.Provider, {
      value: {
        user: {
          id: "a1",
          name: "Platform Person",
          email: "admin@example.com",
          role: UserRole.ADMIN,
        },
        memberships: [],
        business: null,
        selectBusiness: () => undefined,
        businessRole: null,
        permissions: new Set(),
        can: () => false,
        isAdmin: true,
      },
      children: node,
    }),
  );
}

beforeEach(() => {
  mockPathname = "/orders/abc";
});

describe("NavList", () => {
  it("shows an owner the section headings and marks only the open section current", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(NavList));
    for (const heading of ["Production", "Stock", "Catalogue", "Business"]) {
      expect(html).toContain(`>${heading}<`);
    }
    expect(html).not.toContain(">Platform<");
    const current = currentLinks(html);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/orders"');
  });

  it("shows no heading for a section the role cannot open", () => {
    const html = renderAs(UserRole.SHOP_COUNTER, createElement(NavList));
    expect(html).toContain(">Production<");
    expect(html).not.toContain(">Stock<");
    expect(html).not.toContain(">Business<");
  });

  it("marks only the more specific entry when a path sits under two of them", () => {
    mockPathname = "/admin/businesses/abc";
    const current = currentLinks(renderAsPlatformAdmin(createElement(NavList)));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/admin/businesses"');
  });
});

describe("BusinessSwitcher", () => {
  it("is plain text, not a menu, for someone with a single business", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(BusinessSwitcher));
    expect(html).toContain("Mock Print Co");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("<button");
  });

  it("renders nothing for a platform admin, who has no business", () => {
    expect(renderAsPlatformAdmin(createElement(BusinessSwitcher))).toBe("");
  });
});

describe("ConsoleShell", () => {
  it("frames a screen with the skip link, the main landmark and the phone tab bar", () => {
    const html = renderAs(
      UserRole.SHOP_OWNER,
      themed(createElement(ConsoleShell, { children: "SCREEN-BODY" })),
    );
    expect(html).toContain("Skip to content");
    expect(html).toContain('id="main"');
    expect(html).toContain("SCREEN-BODY");
    expect(html).toContain("Search or jump to");
    for (const tab of ["Home", "Orders", "Printers", "Stock", "More"]) {
      expect(html).toContain(`>${tab}<`);
    }
  });

  it("renders for a platform admin with no business selected", () => {
    mockPathname = "/admin";
    const html = renderAsPlatformAdmin(
      themed(createElement(ConsoleShell, { children: "ADMIN-BODY" })),
    );
    expect(html).toContain("ADMIN-BODY");
    expect(html).toContain(">Platform<");
    expect(html).toContain("Platform Person");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/shell/shell.test.ts`
Expected: FAIL, "Cannot find module '@/components/shell/business-switcher'".

- [ ] **Step 3: Create `src/components/shell/icons.tsx`**

Move the `NAV_ICONS` map and the `NavIcon` function out of `src/components/console-shell.tsx` into this file **unchanged** (keep the comments), export `NavIcon`, give it an optional `className` prop defaulting to `"size-[18px] shrink-0"`, and add these entries to `NAV_ICONS`:

```tsx
  billing: "M3 6h18v12H3V6Zm0 4h18M7 15h4",
  // Platform payments and reports reuse the business-side shapes, as the
  // businesses/users entries above already do.
  "admin-payments": "M3 6h18v12H3V6Zm0 4h18M7 15h4",
  "admin-reports": "M5 20V10m5 10V4m5 16v-7m5 7H3",
```

Then add the frame's own icons below it:

```tsx
const ICONS = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  chevrons: "M8 10l4-4 4 4M8 14l4 4 4-4",
  check: "M5 12.500l4.500 4.500L19 7.500",
  more: "M5 7h14M5 12h14M5 17h14",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

/** One of the frame's own 24px stroke icons. Decorative: every use sits beside text or inside a labelled button. */
export function Icon({
  name,
  className = "size-4 shrink-0",
}: {
  name: keyof typeof ICONS;
  className?: string;
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dots" ? "2.6" : "1.8"}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
```

- [ ] **Step 4: Create `src/components/shell/nav-list.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useSession } from "@/components/session-provider";
import { NavIcon } from "@/components/shell/icons";
import { activeNavItem, groupedNav, visibleNavItems } from "@/lib/nav";

/** The grouped navigation, used by the sidebar and by the phone's "More"
 * sheet. What it lists is a pure function of the person's role AT THE
 * SELECTED BUSINESS (`lib/nav.ts`); the API remains the real gate. Exactly
 * one entry is current: the longest matching path, so `/admin/businesses/1`
 * lights "Businesses" and not also the platform "Overview" at `/admin`. */
export function NavList({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  const pathname = usePathname();
  const { user, businessRole, permissions } = useSession();
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );
  const currentId = activeNavItem(pathname, items)?.id;

  return (
    <nav aria-label="Main" className="grid gap-4">
      {groupedNav(items).map((group) => (
        <div key={group.id}>
          {group.label !== null && (
            <p className="px-2.5 pb-1 text-xs font-medium text-muted">{group.label}</p>
          )}
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const current = item.id === currentId;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm max-lg:min-h-11 ${
                      current
                        ? "bg-inv font-semibold text-inv-ink"
                        : "font-medium text-side-ink hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    <NavIcon id={item.id} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Create `src/components/shell/business-switcher.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { Menu, MenuItem } from "@/components/menu";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { Avatar } from "@/components/ui";
import { roleLabel } from "@/lib/permissions";

/** Which business the console is showing. A menu only when there is a choice:
 * with one business it is a plain label, and a platform admin (no business)
 * gets nothing. `compact` is the phone top bar's version. */
export function BusinessSwitcher({ compact = false }: { compact?: boolean }): ReactNode {
  const { memberships, business, selectBusiness } = useSession();
  if (business === null) {
    return null;
  }

  const face = (
    <>
      <Avatar name={business.name} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold text-ink">{business.name}</span>
        {!compact && (
          <span className="block truncate text-xs text-muted">{roleLabel(business.role)}</span>
        )}
      </span>
    </>
  );
  const shell = compact
    ? "flex min-h-11 max-w-[55vw] min-w-0 items-center gap-2.5 rounded-md pr-1"
    : "flex min-h-[50px] w-full min-w-0 items-center gap-2.5 rounded-lg border border-line bg-panel px-2";

  if (memberships.length < 2) {
    return <div className={shell}>{face}</div>;
  }

  return (
    <Menu
      label="Switch business"
      className="min-w-0"
      trigger={(props) => (
        <button type="button" {...props} className={`${shell} hover:border-line-strong`}>
          {face}
          <Icon name="chevrons" className="size-4 shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) =>
        memberships.map((membership) => (
          <MenuItem
            key={membership.id}
            onSelect={() => {
              selectBusiness(membership.id);
              close();
            }}
          >
            <Avatar name={membership.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{membership.name}</span>
              <span className="block truncate text-xs text-muted">
                {roleLabel(membership.role)}
              </span>
            </span>
            {membership.id === business.id && <Icon name="check" className="size-4 shrink-0" />}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
```

- [ ] **Step 6: Create `src/components/shell/account-menu.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, MenuItem } from "@/components/menu";
import { Segmented } from "@/components/segmented";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { useTheme } from "@/components/theme-provider";
import { Avatar } from "@/components/ui";
import { roleLabel } from "@/lib/permissions";
import type { ThemeSetting } from "@/lib/theme";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeSetting; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Who is signed in, the Light / Dark / System setting, and Sign out. Sits at
 * the foot of the sidebar on a desktop and behind the avatar in the top bar on
 * a phone; `placement` only decides the button's look and which way it opens. */
export function AccountMenu({ placement }: { placement: "sidebar" | "topbar" }): ReactNode {
  const router = useRouter();
  const { user, businessRole } = useSession();
  const { setting, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const role = roleLabel(businessRole ?? user.role);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Menu
      label="Account"
      side={placement === "sidebar" ? "top" : "bottom"}
      align={placement === "sidebar" ? "start" : "end"}
      trigger={(props) =>
        placement === "sidebar" ? (
          <button
            type="button"
            {...props}
            className="flex min-h-[50px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-panel-2"
          >
            <Avatar name={user.name} tone="inv" round />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
              <span className="block truncate text-xs text-muted">{role}</span>
            </span>
            <Icon name="dots" className="size-4 shrink-0 text-muted" />
          </button>
        ) : (
          <button
            type="button"
            {...props}
            aria-label={`Account: ${user.name}`}
            className="grid size-11 shrink-0 place-items-center rounded-md"
          >
            <Avatar name={user.name} tone="inv" round />
          </button>
        )
      }
    >
      {() => (
        <>
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted">{role}</p>
          </div>
          <div className="border-t border-line px-2.5 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-muted">Theme</p>
            <Segmented
              value={setting}
              onChange={setTheme}
              options={THEME_OPTIONS}
              ariaLabel="Theme"
              className="w-full"
            />
          </div>
          <div className="border-t border-line pt-1">
            <MenuItem onSelect={() => void signOut()}>
              {signingOut ? "Signing out…" : "Sign out"}
            </MenuItem>
          </div>
        </>
      )}
    </Menu>
  );
}
```

- [ ] **Step 7: Create `src/components/shell/command-palette.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Permission } from "@print-automated/types";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { Kbd } from "@/components/ui";
import { paletteEntries, type PaletteEntry } from "@/lib/command-palette";
import { visibleNavItems, type NavItem } from "@/lib/nav";

/** "Search or jump to": one button in the top bar (a search-shaped bar on a
 * desktop, an icon on a phone) and Ctrl/Cmd+K anywhere. It lists the screens
 * this person may open and, for roles that can see orders, an orders search.
 * It never lists anything `visibleNavItems` would not. */
export function CommandPalette(): ReactNode {
  const { user, businessRole, permissions, business, can } = useSession();
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-9 items-center gap-2.5 rounded-md border border-line bg-panel text-muted hover:border-line-strong max-lg:size-11 max-lg:justify-center lg:w-full lg:max-w-[26rem] lg:px-2.5"
      >
        <Icon name="search" className="size-4 shrink-0 max-lg:size-5" />
        <span className="flex-1 text-left text-sm max-lg:sr-only">Search or jump to…</span>
        <span className="max-lg:hidden">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      {open && (
        <PaletteDialog
          items={items}
          canSearchOrders={business !== null && can(Permission.VIEW_ORDERS)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PaletteDialog({
  items,
  canSearchOrders,
  onClose,
}: {
  items: readonly NavItem[];
  canSearchOrders: boolean;
  onClose: () => void;
}): ReactNode {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const entries = paletteEntries(query, items, canSearchOrders);
  const active = Math.min(index, Math.max(0, entries.length - 1));
  // A local, because the project's noUncheckedIndexedAccess types every
  // indexed read as possibly undefined and does not narrow `entries[active]`.
  const activeEntry = entries[active];

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  function go(entry: PaletteEntry | undefined): void {
    if (entry === undefined) {
      return;
    }
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length > 0) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setIndex((active + step + entries.length) % entries.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(activeEntry);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label="Search or jump to"
      onClose={onClose}
      className="m-auto mt-[12vh] w-[36rem] max-w-[94vw] rounded-lg border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 max-sm:mt-3"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Icon name="search" className="size-4 shrink-0 text-muted" />
        <input
          role="combobox"
          aria-label="Search or jump to"
          aria-expanded={entries.length > 0}
          aria-controls="palette-results"
          aria-activedescendant={
            activeEntry !== undefined ? `palette-${activeEntry.id}` : undefined
          }
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          placeholder="Search or jump to…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-base placeholder:text-muted"
        />
        <Kbd>Esc</Kbd>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted">Nothing matches.</p>
      ) : (
        <ul
          id="palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[50vh] overflow-y-auto p-1.5"
        >
          {entries.map((entry, position) => (
            <li
              key={entry.id}
              id={`palette-${entry.id}`}
              role="option"
              aria-selected={position === active}
              onMouseEnter={() => setIndex(position)}
              onClick={() => go(entry)}
              className={`cursor-pointer rounded-md px-3 py-2 ${position === active ? "bg-panel-2" : ""}`}
            >
              <p className="text-sm font-medium">{entry.label}</p>
              <p className="truncate text-xs text-muted">{entry.hint}</p>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}
```

Keyboard use goes through the input (the combobox pattern: arrows move `aria-activedescendant`, Enter chooses), which is why the options themselves take only pointer events. If ESLint's accessibility rules still reject `onClick` on the `li`, keep the behaviour and satisfy the rule in the smallest way (for example a `tabIndex={-1}` button inside the option), and say so in your report.

- [ ] **Step 8: Create `src/components/shell/bottom-tabs.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { useSession } from "@/components/session-provider";
import { Icon, NavIcon } from "@/components/shell/icons";
import { NavList } from "@/components/shell/nav-list";
import { activeNavItem, bottomTabs, visibleNavItems } from "@/lib/nav";

function tabLook(current: boolean): string {
  return `flex min-h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-[14px] ${
    current ? "font-semibold text-ink" : "font-medium text-muted"
  }`;
}

function pillLook(current: boolean): string {
  return `grid h-7 w-[52px] place-items-center rounded-full ${current ? "bg-inv text-inv-ink" : ""}`;
}

/** The phone and tablet navigation: up to four tabs this role can open, plus
 * "More", which holds the whole grouped list. Hidden from `lg` up, where the
 * sidebar is on screen. "More" is marked current when the open screen is not
 * one of the tabs, so the bar always shows where you are. */
export function BottomTabs(): ReactNode {
  const pathname = usePathname();
  const { user, businessRole, permissions } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );
  const tabs = bottomTabs(items);
  const currentId = activeNavItem(pathname, items)?.id;
  const currentIsTab = tabs.some((tab) => tab.id === currentId);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-side-line bg-side px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        {tabs.map((tab) => {
          const current = tab.id === currentId;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={tabLook(current)}
            >
              <span className={pillLook(current)}>
                <NavIcon id={tab.id} className="size-5" />
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={tabLook(currentId !== undefined && !currentIsTab)}
        >
          <span className={pillLook(currentId !== undefined && !currentIsTab)}>
            <Icon name="more" className="size-5" />
          </span>
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <Modal title="Menu" onClose={() => setMoreOpen(false)}>
          <div className="max-h-[70vh] overflow-y-auto p-3">
            <NavList onNavigate={() => setMoreOpen(false)} />
          </div>
        </Modal>
      )}
    </>
  );
}
```

- [ ] **Step 9: Rewrite `src/components/console-shell.tsx`**

Replace the whole file (the icon map moved to `shell/icons.tsx` in Step 3; `NavList`, `BusinessSwitcher` and `UserMenu` are replaced by the new components):

```tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PlanBanner } from "@/components/plan-banner";
import { Segmented } from "@/components/segmented";
import { useSession } from "@/components/session-provider";
import { AccountMenu } from "@/components/shell/account-menu";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { BusinessSwitcher } from "@/components/shell/business-switcher";
import { CommandPalette } from "@/components/shell/command-palette";
import { Icon } from "@/components/shell/icons";
import { NavList } from "@/components/shell/nav-list";
import { useTheme } from "@/components/theme-provider";

function Brand({ compact = false }: { compact?: boolean }): ReactNode {
  return (
    <Link href="/" className="flex min-h-9 items-center gap-2.5 px-1.5 text-ink">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-inv text-xs font-bold text-inv-ink">
        PA
      </span>
      <span
        className={`text-[15px] font-semibold tracking-[-0.01em] ${compact ? "max-sm:sr-only" : ""}`}
      >
        Print Automated
      </span>
    </Link>
  );
}

/** The permission-aware frame around every signed-in screen.
 *
 * From `lg` up: a sidebar (brand, business switcher, grouped navigation,
 * account menu) and a top bar (search-or-jump, theme, notifications). Below
 * `lg`: the business switcher and account menu move into the top bar and
 * navigation becomes a bottom tab bar with a "More" sheet.
 *
 * Only the middle of the sidebar scrolls. The switcher and the account menu
 * open popovers, and a popover inside a scrolling box would be clipped by it. */
export function ConsoleShell({
  children,
  topBarExtras,
}: {
  children: ReactNode;
  /** Extra controls in the top bar (the notification bell, from 23.7). */
  topBarExtras?: ReactNode;
}): ReactNode {
  const { business } = useSession();
  const { resolved, setTheme } = useTheme();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 z-40 hidden h-screen flex-col gap-3 border-r border-side-line bg-side p-3 lg:flex">
        <Brand />
        <BusinessSwitcher />
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
          <NavList />
        </div>
        <div className="border-t border-side-line pt-2">
          <AccountMenu placement="sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur sm:px-6 lg:gap-3">
          <div className="min-w-0 lg:hidden">
            {business !== null ? <BusinessSwitcher compact /> : <Brand compact />}
          </div>
          <div className="flex-1 lg:hidden" />
          <CommandPalette />
          <div className="flex-1 max-lg:hidden" />
          <Segmented
            value={resolved}
            onChange={setTheme}
            ariaLabel="Theme"
            className="max-lg:hidden"
            options={[
              {
                value: "light",
                label: (
                  <>
                    <Icon name="sun" /> Light
                  </>
                ),
              },
              {
                value: "dark",
                label: (
                  <>
                    <Icon name="moon" /> Dark
                  </>
                ),
              },
            ]}
          />
          {topBarExtras}
          <div className="lg:hidden">
            <AccountMenu placement="topbar" />
          </div>
        </div>
        <PlanBanner />
        <main
          id="main"
          className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 max-lg:pb-28 sm:px-6"
        >
          {children}
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}
```

- [ ] **Step 10: Run the frame tests and confirm they pass**

Run: `timeout 300 node ../../node_modules/jest/bin/jest.js src/components/shell/shell.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 11: Verify the phase**

- `timeout 300 node ../../node_modules/typescript/bin/tsc --noEmit` Expected: exit 0.
- `timeout 300 node ../../node_modules/eslint/bin/eslint.js .` Expected: exit 0.
- `timeout 600 node ../../node_modules/jest/bin/jest.js` Expected: every suite passes, including `colour-guard.test.ts` from Phase 1 (the new files must obey it).
- `timeout 900 node node_modules/next/dist/bin/next build` Expected: "Compiled successfully" and a route table.

- [ ] **Step 12: Leave the work uncommitted** and report the files changed and the exact command results.
