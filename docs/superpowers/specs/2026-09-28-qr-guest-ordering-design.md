# QR guest ordering — replace customer login with anonymous, shop-scoped upload

**Status:** Draft, pending written-spec approval (brainstorming skill, architectural path).
**Author:** Claude (this session), directed by the user, 2026-09-28.
**Supersedes:** the customer-account half of the original PRD's marketplace flow
(`docs/prd/print-automated-master-prd.md`). Everything else that PRD built — shop
discovery, pricing, the order state machine, printing, payments, refunds — is
unchanged; only _how a customer reaches an order_ changes.

## 1. Why

The product owner does not want customers to have accounts, passwords, or a
login screen at all. The intended flow is physical-first: a shop posts one QR
code at its counter/entrance. A customer scans it, lands on a plain web page
tied to that shop, uploads a file, picks print options, sees a price, and
submits — no signup. Submitting returns a second, order-specific QR code. The
customer carries that to the counter; staff scan it with the shop-mobile app,
which confirms the order and lets them record how it was paid (cash, card, or
an online transfer already made elsewhere). From that point on, the order
behaves exactly like any order does today: it enters the same state machine,
gets dispatched, prints, and completes.

This closes out three things the user asked for in one linked request, of
which this spec covers the first (the largest and the one everything else
depends on):

- **(A) Replace customer login with QR-code guest ordering — this spec.**
- (B) Admin-panel user-management pages — separate, smaller, own design pass.
- (C) Marketing/landing page no longer offers a customer-login path — falls
  out of (A) automatically (see §7).

## 2. What already exists that this reuses

Two pieces of prior art make this much smaller than it first looks:

- **`Customer` model** (`prisma/schema.prisma`, added 17.4) is already exactly
  "a shop's own contact record for someone who isn't a `User`": `name`
  (required), `phone`/`email`/`company`/`address` (all optional), scoped to
  one `shopId`, no auth of any kind. Built for the counter-staff-takes-a-
  walk-in-order flow (17.5/`OrderCreationSource.COUNTER`). This is precisely
  the "guest identity" the new flow needs — reused as-is, no new table.
- **`Order.customerId` stays non-nullable**, matching the precedent the
  17.5 schema comment already set for `COUNTER` orders: rather than invent a
  synthetic placeholder `User` (rejected there for good reasons — fake email
  collision risk, no real inbox, a lifecycle nobody owns), a `COUNTER` order's
  `customerId` is set to the _staff member_ who took it, because that's "the
  User account this order belongs to for read/ownership purposes" for that
  order. A QR guest order has no staff member and no logged-in customer, so
  the same reasoning points to the **shop's owner** (`ShopStaff` row with
  `role: SHOP_OWNER` for that shop) as the responsible `User` — an account
  that definitely exists (every shop has exactly one owner, enforced since
  the shop-registration work earlier today), has a real inbox for the
  existing order-lifecycle emails `OrderStateMachine` already sends, and
  needs no new concept. **No migration touches `customerId` at all.**

## 3. What's new

### 3.1 Schema (one migration)

- `OrderCreationSource` gains a third value: `QR_SELF_SERVICE`.
- `Order.guestAccessToken String? @unique` — a new column. **Not**
  `publicOrderNumber`: that's `PA-YYYYMMDD-NNNNNN`, a per-day sequential
  counter (`order-number.service.ts`) — guessable, and already used purely as
  a human-readable label, never as a secret. `guestAccessToken` is a
  separate, cryptographically random value (`crypto.randomBytes(18)`,
  base64url — ~144 bits, no practical enumeration) generated only for
  `QR_SELF_SERVICE` orders; `null` for every other creation source,
  including all existing rows. This is the only new secret this feature
  introduces, so its generation and every place it's checked gets explicit
  test coverage.
- No change to `Customer`, no change to `User`, no change to `customerId`.

### 3.2 Backend (`services/api`)

- `GET /v1/shops/:shopId/upload-info` (public, unauthenticated) — returns the
  minimal shop info the upload page needs (name, capabilities, whether the
  shop is currently `OPEN`) so the page can render without needing a
  separate authenticated lookup.
- `POST /v1/shops/:shopId/guest-orders` (public, unauthenticated, rate
  limited same shape as `/shops/register`) — body: uploaded document
  reference (reuses the existing pre-upload/presigned-URL document flow
  customer-web already has), print configuration, guest `name` (required)
  and optional `phone`/`email`. Server: creates the `Customer` row (or
  reuses one by exact phone match within the shop, mirroring how 17.5's
  counter flow already resolves a returning walk-in customer, if that
  lookup exists there — confirm during planning), creates the `Order` with
  `creationSource: QR_SELF_SERVICE`, `customerId` = that shop's owner,
  `customerRecordId` = the `Customer` row, generates `guestAccessToken`,
  and returns `{ order: { id, publicOrderNumber, ...quote }, guestAccessToken }`.
  Goes through the exact same pricing/quote and order-creation logic
  `OrdersService` already has — this is a new _entry point_, not new order
  logic.
- `GET /v1/guest-orders/:token` (public, unauthenticated) — status lookup by
  `guestAccessToken`. Rate limited per-IP (prevents brute-forcing tokens even
  though the keyspace is large — defense in depth, same posture as every
  other public endpoint in this codebase).
- `POST /v1/shop/guest-orders/:token/confirm-payment` (authenticated,
  shop-staff only, `ShopScopeGuard` — must be staff of the order's own shop)
  — looked up by token, staff records the payment method used and confirms;
  internally calls the _existing_ payment-confirmation step in
  `OrderStateMachine` (no new state-machine writer introduced — hard
  invariant #2 from `CONTEXT.md` stays intact).
- Customer-facing auth endpoints (`POST /auth/register`, `POST /auth/login`
  for the `CUSTOMER` role) are removed from `AuthController`. `UserRole.CUSTOMER`
  stays in the enum (historical rows still reference it — see §4) but is
  never assigned to a newly created `User` again anywhere in the codebase
  after this change.

### 3.3 `apps/customer-web`

- Removed entirely: `/login`, `/signup`, `/dashboard`, `/orders`,
  `/orders/[id]`, and their backing `/api/auth/*` route handlers.
- New: `/upload/[shopId]` — the QR destination. File upload → print options
  → quote (same UI components the current `/upload` + `/configure` +
  `/review` pages already have, re-pointed at the new guest-order endpoints
  instead of the authenticated ones) → on submit, shows the returned
  `guestAccessToken` as a QR code (new `qrcode` npm dependency — nothing in
  this codebase currently generates a scannable QR image; the existing
  "Pair a computer" flow in shop-web uses a typed code, not an image).
- New: `/status/[token]` — enter or land on a token, see the order's current
  status, no login. Public, rate-limited per §3.2.
- The root/marketing landing page's "Sign in" link is removed (§7).

### 3.4 `apps/shop-web`

- Each shop's settings/printers area gets a "Print your QR code" action:
  renders `https://<customer-web-origin>/upload/{shopId}` as a QR image
  (same `qrcode` package) for the owner to download/print. No new backend
  endpoint needed — the URL is deterministic from `shopId`, nothing to
  store.

### 3.5 `apps/shop-mobile`

- New native dependency: camera + barcode scanning. Expo's currently
  recommended API is `expo-camera`'s built-in barcode scanning (the older
  standalone `expo-barcode-scanner` is deprecated) — confirm the exact
  package/version against this repo's installed Expo SDK during planning,
  not assumed here.
- New screen: "Scan order" (reachable from wherever the Production/Orders
  tab already lives) — opens the camera, scans the guest QR, calls
  `POST /v1/shop/guest-orders/:token/confirm-payment` with the staff's
  choice of payment method, then shows the resulting order like any other
  order in the existing Production flow. Everything after this point
  (dispatch, printing, completion) is the existing pipeline, untouched.

## 4. Existing data — deliberately NOT decided by this spec

The user's answer on existing `CUSTOMER` accounts/orders was "delete or
migrate," which covers two very different, irreversible-once-run operations:

- **(a) Leave every existing `CUSTOMER` `User` row and every order that
  references one exactly as-is** — only the ability to _create new_ ones is
  removed. Zero data risk; the "not sure / general worry" about the database
  earlier this session makes an unforced destructive step a bad idea to
  bundle into the same change that removes login.
- **(b) Actively convert historical customer-owned orders into the guest
  shape (strip `customerId`'s meaning, delete/disable the `User` rows)** —
  real, irreversible mutation of production-shaped order and payment
  history, and exactly the kind of shared-dev-DB bulk change
  `CONTEXT.md`'s shared-machine rule 3 says must never happen without an
  explicit, scoped confirmation — not a "recommended default" clicked
  through quickly.

**This spec implements (a) only.** (b), if still wanted after seeing (a) in
place, becomes its own follow-up spec with its own dry-run step, reviewed on
its own — not folded into this change's migration.

## 5. Security notes

- `guestAccessToken` is the only new bearer-secret this feature creates.
  High entropy, unique-constrained, never logged, never returned by any
  endpoint except the one guest-order-creation response and the
  owner-authenticated order-detail views (where it's already visible to
  someone who has a legitimate reason to see it).
- The payment-confirmation endpoint is **staff-authenticated**, not just
  "knows the token" — scanning the QR identifies the order; confirming
  payment still requires being logged-in shop staff scoped to that shop.
  Guessing a token alone cannot mark an order paid.
- Rate limiting on both public guest endpoints, matching this codebase's
  existing posture (§85) rather than inventing a new one.

## 6. Testing

- e2e: guest order creation end-to-end (upload → quote → order created with
  correct `creationSource`/`customerId`/`customerRecordId`/`guestAccessToken`),
  status lookup by token, payment confirmation by staff moves the order
  through the existing state machine identically to today's authenticated
  flow, rate limits on both public endpoints, cross-shop isolation (staff
  of shop A cannot confirm shop B's guest order — `ShopScopeGuard` already
  proven elsewhere, new test confirms it holds here too).
- Migration test: existing orders/users are provably untouched (row counts
  and specific historical rows identical before/after, matching the
  verification approach used earlier today when checking the database's
  health).
- Shop-mobile scanning is the one piece with the same caveat 9.14/24
  already carries in this codebase: no physical camera-based e2e in this
  environment — covered by unit tests around the scan-result → API-call
  wiring, manual QA for the actual camera/scan UX.

## 7. Marketing/landing page (item C)

Once `/login` and `/signup` are removed from customer-web, the landing
page's existing "Sign in" link has nothing left to point at and is removed
in the same change — not a separate follow-up. Confirmed with the user
before implementation that this fully resolves their third ask.

## 8. Explicitly out of scope for this spec

- Item (B), the admin-panel user-management pages — separate design.
- §4(b), the destructive migration of historical customer data.
- Anything about payments changing shape — the QR flow changes _who
  confirms_ payment (staff, via scan) not how payments themselves are
  recorded; `PaymentStatus`/`Payment` model are untouched.
