# Manual payment-proof billing — design

Date: 2026-10-11
Status: implemented (backend, api-client, shop-web); verified live against the dev stack

## Purpose

Business billing does not exist today. Platform admins activate plans by hand
(`POST /admin/businesses/:shopId/plan/activate`, always +30 days), and an expired plan
blocks printing only. There is no payment record and no owner-facing pay/renew UI.

This feature lets a business owner pay outside the app (bank transfer, Easypaisa,
JazzCash) and submit **proof of payment**. A platform admin previews the proof and either
**approves** it, granting 1 month, 1 year, or a custom number of months/years of access,
or **rejects** it. Proofs are stored in S3 permanently and can be viewed again at any time.

## Decisions (agreed with the product owner)

- The owner submits: plan, amount paid, transaction ID, and a screenshot or PDF.
- The admin chooses the access duration at approval time, not the owner.
- Payment account details shown to owners come from an admin-editable
  "payment instructions" text.
- Proofs are kept forever: there is no delete path, and rejected proofs are kept too.
- A rejected owner may submit again.

## Assumptions (open to override)

- Upload path: file sent as base64 inside JSON, validated on the server, stored with
  `StorageService.putObjectBuffer`. The shop-web BFF proxy forwards text only, so
  binary/multipart bodies would be corrupted; this also avoids storage CORS setup.
- Approval extends from the later of now and the current expiry (same rule as
  `extendedExpiry` today), so renewing early does not lose paid days.
- The owner is emailed on approve/reject. The admin has a review queue and gets no
  notification. No in-app notification (it would need a notification-enum migration).

## Data model

New Prisma migration after `20261011100000_plan_pricing_features`.

`PaymentProof`

- `id`, `shopId`, `submittedByUserId`, `planDefinitionId`
- `amountMinor`, `currency`, `transactionRef`
- `fileKey`, `fileName`, `fileContentType`, `fileSize`
- `status`: `PENDING | APPROVED | REJECTED`
- `reviewedByUserId?`, `reviewedAt?`, `rejectionReason?`, `grantedMonths?`
- `createdAt`
- Indexes: `(status, createdAt)`, `(shopId, createdAt)`

`PlatformSettings`: singleton row with `paymentInstructions` (text), `updatedAt`,
`updatedByUserId`.

## API

New module `services/api/src/payment-proofs/`, laid out like `shop-plan/`.

Owner routes (`@Roles(SHOP_OWNER)` plus `MANAGE_SETTINGS`; `shopId` via
`@ShopScopedField`, membership checked in the service):

- `POST /shop/payment-proofs` — body: `shopId`, `planDefinitionId`, `amountMinor`,
  `transactionRef`, file (base64, name, type). Validates magic bytes (JPEG, PNG, PDF),
  caps size at about 5 MB, sanitises the filename, rate limits. At most one `PENDING`
  proof per shop.
- `GET /shop/payment-proofs?shopId=` — the shop's own history.
- `GET /shop/payment-proofs/plans` — the plans an owner can pay for (id, name, price, currency;
  archived and contact-only plans left out). Added during build: the public `/v1/plans` has no
  ids, and the admin plan list is admin-only.
- `GET /shop/payment-proofs/:id/file?shopId=` — the shop's own file.
- `GET /shop/payment-instructions` — readable by shop staff.

Owner routes live under `/shop/` because the shop-web proxy only forwards `shop`, `print-jobs`,
`notifications` and `admin`; this avoids widening that allowlist.

Admin routes (`@Roles(ADMIN)`, like `AdminController`):

- `GET /admin/payment-proofs?status=` (queue) and `GET /admin/payment-proofs/:id`.
- `GET /admin/payment-proofs/:id/file` — streams the stored object with its real
  content-type (the existing documents download hardcodes `application/pdf`).
- `POST /admin/payment-proofs/:id/approve` — body `{ months, planDefinitionId? }`; plan
  is prefilled from the submission.
- `POST /admin/payment-proofs/:id/reject` — body `{ reason }` (required).
- `GET/PUT /admin/payment-instructions`.

Approve runs in one transaction: lock the proof row, require `PENDING`, activate the plan
for the calendar-month duration, mark `APPROVED`, write the audit entry. Reject moves
`PENDING` to `REJECTED`, writes audit, and emails the owner. A second approve or reject
on the same proof returns 409.

Supporting changes:

- Storage key helper `paymentProofKey(id)` in
  `packages/backend-shared/src/storage/storage.service.ts`. Nothing deletes these objects.
- Audit actions `PAYMENT_PROOF_SUBMITTED/APPROVED/REJECTED` in
  `services/api/src/audit/audit-action.ts`.
- Email `sendPaymentProofDecision(...)` in `notifications/notification.service.ts`,
  using the existing `send-email` queue and `sanitizeShopNameForEmail`.

## Plan activation refactor

In `services/api/src/shop-plan/`:

- Extract the body of `ShopPlanService.activate` into `activateInTx(tx, ...)` so approval
  is atomic with the proof status change, with an optional months override.
- Add a pure calendar-month helper beside `extendedExpiry` in `plan-period.ts`
  (months, not 30-day multiples), unit-tested in `plan-period.spec.ts`.
- Existing `activate` callers and `shop-plan.e2e-spec.ts` keep working; the default
  remains `billing_period_days`. Months are recorded in the audit metadata.

## Shared packages

- Zod schemas in `packages/validation/src/payment-proofs/`.
- Response types in `packages/types`.
- `packages/api-client/src/resources/payment-proofs.resource.ts`, registered in
  `client.ts` and `index.ts`, following `plan.resource.ts`; files via `http.requestBlob`.

## Web (shop-web)

Owner: a "Billing" screen under `app/(console)/` with a nav entry in `lib/nav.ts`. It
shows the payment instructions, the submit-proof form (`form-kit.tsx`, `modal.tsx`), and
history with status and rejection reason. `components/plan-banner.tsx` links to it.

Admin: a review queue at `app/(console)/admin/payments`.

- Preview: image via blob URL in `<img>`, PDF via `<iframe>`. No preview component exists
  today, so this is new.
- Approve dialog: presets 1 month / 12 months / custom months (years = 12 x months).
- Reject dialog: required reason.
- Payment-instructions editor on the same page.
- Soft warning (not a block) when the transaction ref duplicates another proof.

View logic lives in `lib/*-view.ts` with colocated tests, like `plan-view.ts`.

## Out of scope

Payment gateway, automatic renewal and dunning, expiry reminder emails, plan-limit
enforcement, refunds and partial payments, admin or in-app notifications, proof deletion.

## Request body size (resolved)

Express's default JSON limit is 100 KB, so `bootstrap.ts` mounts `json({ limit: "8mb" })` on
`/v1/shop/payment-proofs` only. Two things to know:

- `express` is now a direct dependency of `services/api` (it was only a transitive dependency of
  `@nestjs/platform-express`, and `import { json } from "express"` needs it resolvable).
- The parser is wrapped in an arrow function on purpose. `express.json()` returns a function named
  `jsonParser`, and Nest skips registering its own global JSON parser when it finds a layer with that
  name -- which silently disabled body parsing on every route until the wrapper was added.

Verified: a 6.4 MB request goes through the shop-web proxy to the API and the file round-trips
byte-identical; other routes still reject large bodies.

## Risks to verify during implementation (all checked)

- Body size limits for ~7 MB base64 payloads in both the Next BFF proxy
  (`apps/shop-web/src/lib/authenticated-proxy.ts`) and the Nest JSON parser (raise for
  this route only).
- `RolesGuard` rejects a `SHOP_OWNER` role held only at a different shop; use the same
  shop-scope pattern as `shop-settings.controller.ts`.

## Testing

- Unit: month-addition helper (including month-end cases such as Jan 31 + 1 month),
  proof validation (magic bytes, size, type), view helpers.
- E2E `services/api/test/payment-proofs.e2e-spec.ts` (with `createPhase19Fixture` and an
  admin token): submit -> `PENDING`; second pending blocked; non-owner and other-shop
  forbidden; approve with 1 / 12 / custom months moves `expiresAt` correctly and flips
  status once (second approve 409); reject requires a reason; files retrievable by admin
  and owner only; audit rows written; objects remain in storage.
- Manual: submit a PNG and a PDF as owner, approve as admin, confirm the plan banner
  updates and the email lands in MailHog; confirm a rejected proof still previews.
- Run lint, typecheck and the jest suites for api, api-client and shop-web.
