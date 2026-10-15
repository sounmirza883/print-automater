# Customer site redesign (apps/customer-web)

Date: 2026-10-15
Status: approved in chat (the owner liked the shop-web redesign and said "do
whatever you think is right"; keep the work on branch
`redesign/shop-web-console`)
Builds on: `docs/superpowers/specs/2026-10-13-shop-web-console-redesign-design.md`

## Why

customer-web is what a customer sees after scanning a print shop's QR code at
the counter: name and phone, upload a file, choose print options, get an order
number to show at collection. It also has a short home page and a "For print
shops" page. Today all three use unstyled defaults (grey text, browser radio
lists, a blue button), so the customer side looks unfinished next to the
redesigned back office. The owner wants the same look here.

## Who uses it, and how

A walk-in customer, on their own phone, standing at a counter, often for the
first time and once. So: phone first, large targets, one obvious next step,
nothing to sign up for, and nothing that has to be learned.

## Out of scope

- No API, validation, route or behaviour changes. The QR flow keeps its four
  steps, its validation (the shared Zod schema and page-range rule), its API
  calls, its idempotency key and its error wording.
- No in-app theme switch. Both themes are designed; the page follows the
  device's light or dark setting. A one-time guest gains little from a setting,
  and the shop-web `shop_theme` cookie is not read here.
- No changes to shop-web, marketing-web or shared packages.
- The Playwright `e2e/golden-path.spec.ts` drives routes this app no longer has
  (`/login`, `/upload`, `/orders/:id`, removed in an earlier fix wave). It is
  stale before this work and stays out of scope; it is noted in the report.

## Look

The shop-web identity, unchanged: the same colour tokens for light and dark
(neutral greys; solid ink for primary actions; colour only for status), Geist
and Geist Mono, 9px controls and 12px cards, a visible focus ring, motion only
on hover and focus and none under reduced motion. Text contrast at least
4.5:1 in both themes, pinned by a test as in shop-web.

The tokens, the fonts and a few small components are copied from shop-web
rather than shared: the two apps deploy separately (customer-web has its own
Docker image), and moving them into a package now would also mean reworking
the just-finished shop-web. Each copy says where it comes from.

## Pages

- **Frame**: a slim header with the brand (logo tile and "Print Automated")
  and a footer line. No navigation beyond the brand link home.
- **Home (`/`)**: a headline that says what this is ("Print from your phone.
  Collect at the counter."), the three steps of the QR flow as numbered cards
  (scan the code at your print shop, upload and choose options, collect and
  pay at the counter), a note that there is no account and no app, and a
  secondary link "For print shops". There is still no "start" button: a
  customer always starts from a shop's own QR code.
- **For print shops (`/for-shops`)**: the same frame, a headline, three short
  points (what the business receives), the existing sentence that staff sign in
  from the Shop app, and a link back.
- **QR flow (`/s/[shopId]/upload`)**, one page, four steps:
  - a step indicator ("1 Your details · 2 Your file · 3 Print options") above
    each of the first three steps, the current one in ink;
  - **Your details**: two large fields and a full-width Continue button;
  - **Your file**: a large drop zone that on a phone is simply a big "Choose a
    file" button, accepted types underneath, a real progress bar while
    uploading, and the existing rejection and error messages as notices;
  - **Print options**: the file name in a card at the top; Colour, Sides,
    Orientation and Pages as segmented choices (native radio inputs styled as
    segments, so the form semantics and keyboard behaviour stay); the page
    range inputs when "Page range" is chosen; Copies as a stepper (minus,
    number, plus) around the existing number input; Paper size and Paper type
    as selects; Finishing as toggle chips (native checkboxes styled); the
    submit error as a notice; on a phone the "Place order" button sits in a bar
    fixed to the bottom of the screen, above the page's own bottom padding;
  - **Confirmation**: a card with "Order placed", the order number large in
    Geist Mono, and the shop name; the document and the configuration; the price
    breakdown with the total; and the existing instruction to show the number
    at collection.

## Code

- `src/app/globals.css`: the three theme blocks, the `@theme inline` mapping
  and the base rules copied from shop-web's `globals.css` (not shop-web's
  phone-tab-bar, table-card, tab or palette rules, which have no use here).
- `src/app/fonts.ts` and `src/app/fonts/` (the two `woff2` files and the OFL
  licence, copied).
- `src/components/ui.tsx`: `Button`, `INPUT`, `Field`, `Notice`, `Card`,
  `ChoiceGroup` (segmented radios), `ChipToggle` (styled checkbox), `Stepper`
  (for copies), `BrandMark`, `SiteFrame` (header, main, footer).
- The QR page keeps its state machine; each step moves to its own file under
  `src/components/qr/`, with its logic unchanged.
- Tests: the copied stylesheet test (both themes, contrast), a colour guard
  (no default greys, no inline colour styles, no `text-white` except on the
  danger fill), static-markup tests for the kit and for each QR step's form
  (labels, input types, the submit button), and the existing logic tests
  unchanged. jest gets the same TSX transform shop-web uses.

## Done when

Typecheck, lint, the unit tests and `next build` pass for customer-web; a
browser pass with fixture data shows all four steps and both static pages in
light and dark at 1440px, 390px and 360px with no sideways overflow and no page
errors; and the work is committed on `redesign/shop-web-console` without
touching other sessions' uncommitted files.

## Decisions made during the build

- **Built in two tasks** (look, kit and static pages; then the QR flow) by the
  `frontend` agent, each reviewed by `code-reviewer`, then a whole-change review.
  The per-task reviews compared the QR flow's logic line by line with the old
  page: same state machine, idempotency key, validation, request bodies and
  submit-disabled conditions.
- **No `next build` inside the app during the work.** Another session's dev
  server was serving customer-web from `.next` on port 3001, and a build would
  have replaced that folder under it. The build and the browser pass ran from an
  isolated copy of the app in a scratch folder instead.
- **The file input is now reachable from the keyboard.** It was
  `display: none` inside its label, so Tab never reached it. It is now visually
  hidden (`sr-only`) and its label shows the focus ring. This is the one
  deliberate change beyond the look.
- **`buttonClass()`** is exported from the kit so links and the file label that
  must look like buttons share the button's exact classes.
- **The selected segment has a thin ring.** In dark mode the shop-web segment
  style (panel on panel-2) left the chosen option hard to see; on a form where
  the choice is the point, the ring makes it clear in both themes.
- **The browser pass found a phone bug that every test passed:** the file-name
  card on "Print options" widened the page by 91px on a phone (a grid item keeps
  its content's width unless told `min-w-0`), which also pushed the fixed
  "Place order" bar below the screen. Fixed, and the pass now measures overflow
  against the device width and checks that the bar is on screen.
- **Spelling:** customer copy uses "color" (as the form always has).

## Known follow-ups

- The page-range error text comes from `validatePageSelection` and reads like a
  developer message ("Invalid page range: from=30, to=24."). It was left as is
  because wording was out of scope.
- The Playwright `e2e/golden-path.spec.ts` still drives routes that no longer
  exist (stale before this work).
- The kit, tokens and fonts are copies of shop-web's; a change to one should be
  made to the other.
