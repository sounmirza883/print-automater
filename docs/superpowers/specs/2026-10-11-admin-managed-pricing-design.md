# Admin-managed pricing (plans, features, Compare table)

Status: draft for review. Date: 2026-10-11.

## Goal

The admin panel (`/admin/plans`) is the single source of truth for everything on the
marketing site's Pricing section: plan cards, prices and currency, the Monthly/Annual
toggle, the "Most popular" badge, each card's feature bullets, and the Compare plans
table. Everything is stored in Postgres. Nothing about plans is hard-coded in
marketing-web.

## Already done (commit d495f01)

Public read-only `GET /v1/plans` (name, priceMinor, currency, billingPeriodDays,
description of non-archived plans); the marketing Pricing section renders cards from it
and shows an "unavailable" card if the API is down. The Compare table and the annual
toggle were dropped in that slice; this spec brings them back, DB-driven.

## Decisions (from the owner)

- Shared feature rows: feature rows are defined once; each plan sets a value per row.
  The Compare table is the full matrix; card bullets come from the same rows.
- Look stays as before: Monthly/Annual toggle, "Most popular"
  badge, bullets on cards, Compare plans table with Capacity / Automation / Reporting /
  Support groups.
- Currency: PKR. Prices (integer minor units = paisa):

  | Plan       | Monthly    | Annual (365 days) |
  | ---------- | ---------- | ----------------- |
  | Starter    | PKR 6,000  | PKR 60,000        |
  | Growth     | PKR 11,000 | PKR 110,000       |
  | Business   | PKR 15,000 | PKR 150,000       |
  | Enterprise | Custom     | Custom            |

  There is no "2 months free" offer. On the Annual view each paid card shows a
  struck-out price (monthly x 12, calculated, never stored) next to the discounted
  annual price, with a "Save PKR X" note (X = monthly x 12 - annual). The toggle is
  labelled "Annual".

- Enterprise: every limit and feature is "Custom"; the card shows "Custom pricing" and a
  "Contact us" button instead of a price. Talking to the team is the only way to get it.
- Only the features in the current list are offered; new ones are added later as rows.
- Seeding: a one-off, idempotent seed loads the four plans and the Compare table from
  the current `content/pricing.ts` content, after which every cell is editable in admin.

## Data model (one Prisma migration)

`plan_definitions` gains:

- `annual_price_minor Int?` - price for 365 days; null = no annual option (toggle
  hides that plan's annual price and falls back to monthly).
- `highlighted Boolean @default(false)` - "Most popular" badge and emphasised card.
- `contact_only Boolean @default(false)` - custom pricing; `price_minor` ignored for
  display, card shows "Custom pricing" + "Contact us".
- `sort_order Int @default(0)` - card and column order (cheapest-first becomes
  explicit).
- `price_minor` and `billing_period_days` keep their meaning: monthly price and a
  30-day activation period. Existing activate/renew/cancel behaviour is unchanged.

New `plan_features`: `id`, `section` (e.g. Capacity), `label` (e.g. Printers),
`sort_order`, `show_on_card Boolean`, `card_text String?` (optional template, e.g.
`Up to {value} printers`; null = default rendering).

New `plan_feature_values`: `plan_id`, `feature_id`, `value String`, unique
`(plan_id, feature_id)`, FKs with cascade delete. `value` is `true` (tick), `false`
(dash) or free text (`10`, `Unlimited`, `Custom`). A missing row renders as a dash.

Card bullet for a feature with `show_on_card`: tick -> `label`; text value -> `card_text`
with `{value}` substituted, else `label: value`; dash -> omitted.

## API

Admin (ADMIN role, same guards as today's plan routes):

- `POST/PATCH /admin/plans[/:id]` additionally accept `annualPriceMinor`, `highlighted`,
  `contactOnly`, `sortOrder`, and `values` (map featureId -> value, replaces that plan's
  values atomically).
- `GET/POST/PATCH/DELETE /admin/plan-features[/:id]` for the rows.
- Responses extend `PlanDefinitionResponse` in `packages/types`; validation in
  `packages/validation`.

Public `GET /v1/plans`: unauthenticated, read-only. Returns non-archived plans ordered by
`sortOrder` (with the new plan fields) plus `features` grouped by section with each
plan's values. Never returns `id`, `archived`, `subscriberCount` or timestamps.

## Admin UI (extend `plans-screen.tsx`)

- Plan form: annual price, "Most popular", "Contact us (custom pricing)", sort order,
  and a grid with one row per feature (Tick / Dash / Text selector).
- New "Features" tab: add, rename, regroup, reorder, delete rows; per-row "show on card"
  and card text.
- Prices are entered in major units (PKR 6,000) and stored as minor units, using the
  same conversion the existing form uses.

## Marketing site

`Pricing.tsx` stays a server component with the existing 60 s revalidate. A small client
component handles the Monthly/Annual toggle. Cards show name, description, formatted
price (`formatPlanPrice`), badge, bullets, and `Talk to us` (`Contact us` + "Custom
pricing" for `contactOnly`). Compare plans table renders the full matrix with a highlight
on the "Most popular" column. API down -> "Pricing is unavailable right now" card; zero
plans -> "Plans are being finalised"; never a fabricated price. `content/pricing.ts`,
`lib/pricing.ts` and the "Placeholder pricing" note are removed.

## Out of scope

- Choosing monthly vs annual when an admin activates a business: activation still
  extends by the plan's `billing_period_days` (30). The annual price is what the public
  site advertises; selecting an annual term at activation is a separate change.
- Payment gateway (there is none; admins activate plans by hand).
- Per-currency conversion: each plan carries one currency; the admin enters it.

## Testing

- API e2e: feature CRUD, plan create/update with `values`, public `/v1/plans` shape
  (no archived plans, no admin-only fields, ordering, contact-only), validation errors.
- Unit: card-bullet generation, annual/monthly price selection, formatting (PKR whole
  amounts), table rendering helpers.
- Seed: idempotent (run twice = same rows).
- Manual walkthrough: edit a price, tick a feature, flip "Most popular" in admin; confirm
  the marketing page updates within ~60 s and inspect the DB rows.
