# Business console redesign (apps/shop-web)

Date: 2026-10-13
Status: built and verified 2026-10-13 (phases 1 to 3)
Mockup: https://claude.ai/artifact/2tjqsqdTpCqr6mVgZPUAyD (dashboard, orders, phone; light and dark)

## Why

The owner/admin console works but looks plain, and its structure has grown by
accretion. The owner asked for a console that reads as professional the moment
it opens, with a strong black-and-white identity, and with light and dark both
fully designed and selectable in the app. Four structural problems were
confirmed and are in scope:

1. Navigation is one flat, ungrouped list: 13 links for an owner, 7 for a
   platform admin. (`NAV_ITEMS` holds all 19 in one array, two of them
   labelled "Reports", but no account sees both sets: a platform admin has no
   business membership, and business staff never see platform entries.)
2. Every screen is the same stack of bordered panels and tables.
3. The top bar has a raw `<select>` for switching business and a bare
   "Sign out" button; there is no account menu and no way to jump to a screen.
4. It is desktop-first: a slide-over drawer and tables that scroll sideways.

## Out of scope

- No API, DTO, permission, route or behaviour changes. `lib/*-view.ts`,
  `lib/permissions.ts`, `use-resource`, the BFF proxy and every exported pure
  function keep their signatures and results.
- `packages/design-tokens` values are not changed (customer-web and
  shop-mobile consume them). The console's look lives in
  `apps/shop-web/src/app/globals.css`, layered on the tokens as today.
- No UI library. Native `<dialog>` stays the modal primitive.
- The model stays `Shop` in code; copy says "Business".

## Visual identity

Monochrome. Neutral greys with no tint; solid ink is the brand. Colour appears
only to carry status (blocked, paid, low stock) and for links and focus.

### Colour tokens

Existing Tailwind token names are kept so every screen re-skins without edits.
New names are marked (new).

| Token (Tailwind name) | Light     | Dark      | Use                                                               |
| --------------------- | --------- | --------- | ----------------------------------------------------------------- |
| `surface`             | `#f6f6f6` | `#0a0a0a` | app background                                                    |
| `panel`               | `#ffffff` | `#131313` | cards, inputs, menus                                              |
| `panel-2`             | `#f0f0f0` | `#1c1c1c` | sunken fills, table heads, segmented tracks                       |
| `ink`                 | `#0a0a0a` | `#f5f5f5` | primary text                                                      |
| `ink-2` (new)         | `#3a3a3a` | `#d0d0d0` | secondary text, idle nav items                                    |
| `muted`               | `#646464` | `#a0a0a0` | captions, hints (>= 4.5:1 on surface and panel)                   |
| `line`                | `#e3e3e3` | `#272727` | hairlines                                                         |
| `line-strong` (new)   | `#cfcfcf` | `#3a3a3a` | hover borders, chart rest bars                                    |
| `side`                | `#ffffff` | `#0a0a0a` | sidebar, phone bars                                               |
| `side-ink`            | `#3a3a3a` | `#d0d0d0` | sidebar text                                                      |
| `side-line`           | `#e3e3e3` | `#272727` | sidebar borders                                                   |
| `inv` (new)           | `#0a0a0a` | `#f5f5f5` | primary buttons, active nav item, count badges                    |
| `inv-ink` (new)       | `#ffffff` | `#0a0a0a` | text on `inv`                                                     |
| `brand` (new)         | `#0a0a0a` | `#131313` | the sign-in page's brand panel: dark in both themes, unlike `inv` |
| `brand-ink` (new)     | `#ffffff` | `#f5f5f5` | text on `brand`                                                   |
| `accent-fg`           | `#1e46b8` | `#93b4ff` | links, focus ring, info text                                      |
| `good-fg`             | `#166534` | `#4ade80` |                                                                   |
| `caution-fg`          | `#8a4b0a` | `#fbbf24` |                                                                   |
| `danger-fg`           | `#b42318` | `#f87171` |                                                                   |
| `accent-soft`         | `#e8effe` | `#111b33` | info pill fill                                                    |
| `good-soft`           | `#e7f6ec` | `#0f2417` |                                                                   |
| `caution-soft`        | `#fdf1dc` | `#2a1f08` |                                                                   |
| `danger-soft`         | `#fdeceb` | `#2b1212` |                                                                   |

The solid fills `accent`, `good`, `caution`, `danger`, `quiet` keep coming from
`@print-automated/design-tokens` (dots, bars, the danger button).

Rule that makes dark mode work: **nothing pairs `bg-accent` with `text-white`
for a primary action any more.** Primary actions are `bg-inv text-inv-ink`.
`text-white` survives only on `bg-danger`. Active tab rules use `border-ink`.

Panels get `shadow-panel`: `0 1px 2px rgb(10 10 10 / 0.06)` in light, none in
dark (dark relies on hairlines).

### Type, shape, motion

- Geist for text and Geist Mono for identifiers (order numbers, IDs), vendored
  as variable `woff2` under `src/app/fonts/` and loaded with `next/font/local`
  (no build-time network, no new dependency). System stack as fallback.
- Body 14px/20px. Page title 24px/30px semibold, tracking -0.02em. Panel title
  14px semibold. Table head and captions 12px medium, sentence case (the
  uppercase tracked labels go away). Figures use `tabular-nums`; `.num` stays
  as the class and now means Geist Mono + tabular.
- Radius: 12px panels, 9px controls, full pills. Control height 36px desktop,
  44px on phone.
- Motion: 150ms ease on background, border and colour for interactive
  elements; none under `prefers-reduced-motion`.
- No left-border accent bars. The active nav item is a solid `inv` pill.

## Theme

- Setting: Light / Dark / System. Stored in the cookie `shop_theme`
  (`light` | `dark` | `system`, 1 year, `SameSite=Lax`, path `/`).
- The root layout (server) reads the cookie and renders
  `<html data-theme="light|dark">`; for `system` or no cookie it renders no
  attribute and CSS falls back to `prefers-color-scheme`. No inline script, no
  flash.
- CSS: light values on `:root`; dark values under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
  and again under `:root[data-theme="dark"]`. `color-scheme` follows.
- `lib/theme.ts` (pure, tested): `parseThemeCookie(value)`,
  `themeAttribute(setting)`, `themeCookie(setting)`.
- `ThemeProvider` (client) holds the setting, writes the cookie and the
  attribute on change. Controls: a Light/Dark segmented control in the top bar
  on desktop, and the full Light/Dark/System choice in the account menu.

## Shell

### Navigation model (`lib/nav.ts`)

`NavItem` gains `group`. `visibleNavItems` and `activeNavItem` keep their
behaviour. New pure helpers, all unit-tested:

- `NAV_GROUPS`: ordered `{ id, label }`: `overview` (no label), `production`
  "Production", `stock` "Stock", `catalogue` "Catalogue", `business`
  "Business", `platform` "Platform".
- Membership: overview = dashboard, notifications; production = orders,
  printers, customers; stock = inventory, suppliers, purchase-orders;
  catalogue = products; business = staff, reports, billing, settings;
  platform = admin (label becomes "Overview"), admin-businesses, admin-users,
  admin-plans, admin-payments, admin-reports.
- `groupedNav(items)` returns the non-empty groups, in `NAV_GROUPS` order,
  for the items a role can see.
- There is no Business / Platform switch. The mockup showed one, but no
  account can see both sets today (a platform admin has no memberships), so
  it would be a control that never appears. A platform admin simply gets the
  Platform group.
- `bottomTabs(items)` returns up to four phone tabs by priority (dashboard,
  orders, printers, inventory, customers, then admin, admin-businesses,
  admin-payments, admin-users), skipping what the role cannot see.

### Desktop (>= lg)

- Sidebar, 248px, themed (white in light, near-black in dark): brand; the
  business switcher; grouped nav; the account button pinned at the bottom.
- Business switcher: a button showing initials, business name and the
  person's role there, opening a menu of memberships. One membership renders
  as a static card. No business (platform-only admin) renders nothing.
- Account menu: name, email, role, the three-way theme choice, Sign out.
- Top bar: "Search or jump to" (opens the command palette, also Ctrl/Cmd+K),
  the Light/Dark control, the notification bell.
- Command palette: a `<dialog>` listing the screens the role can see, filtered
  as you type, arrow keys and Enter to go. When the role has `VIEW_ORDERS` and
  text is typed, the last row is "Search orders for ..." which goes to
  `/orders?q=...` (last, so a typed screen name still lands on the screen;
  when no screen matches it is the only row). Filtering is a pure function in
  `lib/command-palette.ts`.

### Phone and tablet (< lg)

- Top bar: business switcher on the left, bell and account avatar on the right.
- Bottom tab bar: the `bottomTabs` plus "More", which opens a bottom sheet
  with the full grouped nav. The slide-over drawer is removed. Main content is padded so the bar never covers it; the bar respects
  `env(safe-area-inset-bottom)`.
- Dialogs become bottom sheets (full width, rounded top, max 90vh, scrollable
  body, actions pinned).

## Component kit

`components/ui.tsx`, `form-kit.tsx` and `modal.tsx` keep every export and prop
so the 93 screen files compile unchanged, and are restyled to the identity
above. Additions:

- `Button`: `variant` gains `"danger"`; new `size?: "sm" | "md"`. Primary is
  `inv`. `FormDialog` uses `Button` instead of its hand-built submit.
- `Segmented` (period pickers, theme), `Tabs` (link or button tabs
  with optional counts), `Toolbar` (search + filters + actions row),
  `IconButton`, `Avatar`, `Kbd`, `Menu` (button + popover, Escape and
  outside-click close, focus returns).
- `Modal` is centred from `sm` up and a bottom sheet below it; there is no
  separate sheet component.
- `DataTable`: table head on `panel-2`, 12px sentence-case head, contained
  sideways scrolling. Opt-in `stackOnPhone` (phase 3): below `sm` each row is a
  card of label/value lines; rows are built with `Row` and `Cell`, which carry
  explicit table roles and the cell's `data-label`.
- Phase 3 also adds `Notice` (the one tinted message box; sets no ARIA role of
  its own), `BackLink`, `DetailGrid`, `Panel flushOnPhone`, and `AuthFrame`
  for the three signed-out pages.
- `Panel`, `Stat`, `Pill`, `EmptyState`, states, `Pager`, fields: restyled.
  Inputs are 36px (44px on phone) with a visible focus ring.

## Page patterns

- **Dashboards**: "Needs attention" first, then the KPI grid, then charts and
  breakdowns, then recent activity. Period pickers use `Segmented`.
- **List screens**: `PageHeader` (title, count/freshness, primary action) →
  `Tabs` where the screen has groups → `Toolbar` → table or list → `Pager`.
  Orders, printers, inventory, customers, staff, businesses, users and
  payments render as card rows on a phone instead of a sideways-scrolling
  table.
- **Detail pages**: a back link, then a two-column grid at `xl` (the working
  area, then a narrower column of reference facts); one column below `xl`,
  main first. Actions stay where each screen has them, at the top of the main
  column. (An earlier draft put them in a sticky bar on a phone; dropped,
  because an order's action bar wraps to several rows and a sticky block that
  tall covers the content it acts on.)
- **Blocked or failed work** shows the reason and the fix inline, tinted
  `danger-soft` or `caution-soft`.
- **Auth pages** (login, set up account, accept invite) take the same
  identity and follow the theme.

## Accessibility

Kept from today and re-verified: text contrast >= 4.5:1 in both themes, pills
always carry text, one visible focus ring, real buttons and links, skip link,
`aria-current` on the active nav item, reduced-motion respected. New: 44px
targets on phone; the palette, menus and sheets close on Escape and return
focus.

## Phases

Each phase ends with `lint`, `typecheck`, `test` and `build` green for
`@print-automated/shop-web`, and nothing is committed by an agent.

1. **Foundation**: fonts, tokens for both themes, theme setting, kit restyle
   and additions, the `bg-accent text-white` sweep. Result: every screen is in
   the new identity in both themes.
2. **Shell**: nav groups and helpers, sidebar, business switcher, account
   menu, command palette, phone tab bar and More sheet.
3. **Screens**, in batches: dashboards; orders and order detail; printers;
   stock (inventory, suppliers, purchase orders); catalogue and people
   (products, customers, staff); reports, settings, billing, notifications;
   platform admin; auth pages and shared states.

## Testing

- Existing jest suites keep passing unchanged, except `nav.test.ts`, which
  gains cases for the new helpers.
- New unit tests: `theme.test.ts`, the new `nav.ts` helpers,
  `command-palette.test.ts`.
- Manual check per phase: both themes, at 1440px and at 390px, on the
  dashboard, orders, an order detail, a form dialog and login.

## Decisions made during the build

The owner approved the mockup and said to start; everything below was decided
by the agent running the build, without stopping to ask. Each line says what
was decided, why, and what it costs if it was the wrong call.

### What you get that differs from the mockup or the first draft of this spec

- **No Business / Platform switch.** The mockup showed one. No account can see
  both sets of screens today (a platform admin has no business membership;
  business staff never see platform screens), so the control would never have
  appeared. If admins later join businesses, the sidebar will list Platform
  under the business groups until a switch is added.
- **Two-column detail pages start at 1280px, not 1024px.** Beside the sidebar,
  the main column would have been phone-width on a 1024px screen. Between 1024
  and 1279px detail pages stay one column, as they were before the redesign.
- **No sticky action bar on phone detail pages.** An order's action bar wraps
  to several rows; stuck to the bottom it would cover what it acts on. On a
  phone you scroll to the top of an order to act on it.
- **Phone cards on the ten main lists only** (customers, suppliers, staff and
  its invitations, products, purchase orders, inventory, businesses, users,
  payments). Smaller tables and tables inside dialogs still scroll sideways.
- **The palette's "Search orders for ..." row is last, not first**, so typing
  a screen's name lands on the screen.
- **The sign-in page's brand panel is dark in both themes.** With the
  theme-flipping ink colour it turned most of the dark sign-in screen white.
- **Menus are popovers with dialog semantics**, not ARIA menus: they hold
  mixed content (account details, the theme choice, links). Tab moves between
  items; there is no arrow-key navigation.
- **Every dialog has a close button; only the phone menu sheet and the palette
  close on a tap outside.** Form dialogs do not, so a stray tap cannot discard
  what was typed.
- **Navigation order inside a group follows the existing list** (Business:
  Staff, Reports, Settings, Billing), because existing tests pin that order.
- **No separate polish pass for dashboards, reports, settings and billing.**
  They take the new look from the kit; nothing was restructured there.
- **Two labels changed:** "Orders / Queue" is "Orders & queue", and the
  platform entry "Platform" is "Overview" (its group heading says Platform).

### How it was built

- **In the shared working tree, without commits along the way.** Another
  session's payment-report work lived only in that tree and the redesign had
  to build on it; committing was left to the owner. Cost: the two were
  interleaved (see "How it was committed" below).
- **Without pausing for a separate spec review or plan review**, on the
  owner's "ok now work on it" after they saw the mockup and the phase plan.
  Cost: rework of anything in this document they would have changed.
- **Fonts are vendored** (two `woff2` files and the OFL licence under
  `src/app/fonts/`) rather than fetched from Google at build time or added as
  a dependency. Cost: about 115 KB of binaries in the repository.
- **Every route is now rendered per request**, because the root layout reads
  the theme cookie so the first paint is already in the right theme.
- **Prettier was run over the files the redesign created or changed** (not the
  other session's), so what was tested is what the pre-commit hook would
  produce.
- **Reviews were done against directory snapshots**, since there were no
  commits to diff; one senior review covered phases 1 and 2 together and a
  second covered phase 3.

### Found by rendering, not by tests

Four defects passed typecheck, lint, the full test suite and the build, and
were caught only by driving the real app in a browser with fixture data:

- pressing Enter in the palette chose the wrong row when the mouse was resting
  where the palette opens;
- every titled panel lost its header padding, because a class name was glued
  to a template expression (`py-3.5${...}`) and Tailwind no longer generated
  it. A guard test now fails on that shape;
- in dark mode the sign-in page was mostly white;
- the palette's search box showed a focus ring as a blue rectangle.

The senior reviews found five more by reading the code: the Settings save bar
hidden under the phone tab bar; the orders filter form going stale after a
search made from the palette; detail pages overflowing on a phone; one long
email widening every phone card; and the two-column layout being too tight
below 1280px. All are fixed.

## How it was committed

On the owner's word ("commit it"), as two commits on the branch
`redesign/shop-web-console`, cut from `main`:

1. The platform payment report that was waiting in the same tree (API, client,
   types, validation, and its admin screen), because the redesign builds on it.
2. The redesign. It also carries the navigation entry for that report: the
   entry lives in `lib/nav.ts`, which the redesign reworks, so the two could
   not be split there. Between the two commits the report screen exists at
   `/admin/reports` but is not linked from the sidebar.

## Known follow-ups

None of these blocks using the console; each was judged able to wait.

- On a phone the reference column comes after the main column, so an order's
  facts and delivery controls sit below its history, and a supplier's contact
  details below its items.
- `blocked-note.tsx` is still a hand-written tinted box (its borders are a
  shade stronger than `Notice`'s).
- `IconButton`, `Toolbar` and `THEME_SETTINGS` are in the kit with no user
  yet; the notification bell hand-writes the `IconButton` recipe.
- The products screen's tabs lost their `tablist` roles when they moved to the
  shared `Tabs` (which marks the current tab with `aria-current`).
- On a phone, a dialog tall enough to scroll carries its close button away
  with the content; its actions are not pinned.
- The palette hint always reads "Ctrl K" (Cmd also works on a Mac).
- A Light setting on a dark operating system may flash dark for an instant on
  a hard reload (the browser paints its canvas before the page's attribute
  applies). Not observed; noted by review.
- The source-scanning guard is line-based: it catches the shapes that actually
  occurred, not every way to write a class Tailwind cannot see.
- Menu open/close, dialog focus and the phone sheet are verified by a browser
  script that lives outside the repository; the jest suite (no DOM) cannot
  drive them. Bringing a DOM test environment or that script into the repo
  would pin them.
