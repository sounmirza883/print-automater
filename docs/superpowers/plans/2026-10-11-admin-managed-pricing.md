# Admin-managed pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/plans` the single source of truth for everything in the marketing Pricing section (cards, PKR prices, Monthly/Annual toggle, "Most popular", feature bullets, Compare plans table), stored in Postgres.

**Architecture:** Extend `plan_definitions` (annual price, highlighted, contact-only, sort order) and add shared feature rows (`plan_features`) with per-plan values (`plan_feature_values`). Admin routes edit them; the public `GET /v1/plans` returns plans + features; the marketing site renders cards and the table from that payload and never from hard-coded content. A one-off idempotent seed script loads Starter/Growth/Business/Enterprise and the full Compare table.

**Tech Stack:** Prisma 6 / Postgres, NestJS + nestjs-zod, Zod (`@print-automated/validation`), `@print-automated/types`, `@print-automated/api-client`, Next.js (shop-web admin, marketing-web), Jest.

**Spec:** `docs/superpowers/specs/2026-10-11-admin-managed-pricing-design.md`

## Global Constraints

- Money is integer minor units + ISO 4217 code (PKR 6,000 = `600000`). Never floats.
- Annual price covers 365 days; the struck-out price is `priceMinor * 12`, **calculated, never stored**. There is **no** "2 months free" copy anywhere.
- Enterprise is `contactOnly`: card shows "Custom pricing" + "Contact us"; every table cell is `Custom`.
- Seed prices (minor units): Starter 600000 / 6000000, Growth 1100000 / 11000000, Business 1500000 / 15000000, all `PKR`.
- Public `GET /v1/plans` is unauthenticated, read-only, excludes archived plans, and never returns `id`, `archived`, `subscriberCount`, timestamps. Values are keyed by plan **name** (unique).
- Prisma: never use the dev `DATABASE_URL` as `--shadow-database-url`. Write the migration SQL by hand; verify drift with `prisma migrate diff --from-url <dev> --to-schema-datamodel prisma/schema.prisma`.
- Activation is unchanged: it still extends by `billing_period_days` (30). No annual-term selection at activation.
- Windows dev box: run jest directly under `timeout` (not via pnpm/cmd wrappers); e2e uses Redis DB 9. Only kill processes you spawned.
- One committer: commit only the files each task lists, with explicit pathspecs (`git commit -m ... -- <paths>`); other sessions share this working tree and index. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A plan with no `values` rows (all dashes) must render in the table and produce zero card bullets, not crash.
- A `values` map naming a feature id that does not exist must be rejected (400), not a raw 500.
- `contactOnly` plan with `priceMinor: 0` must never print "PKR 0"; a paid plan with `priceMinor: 0` still prints "PKR 0".
- Annual price >= monthly*12 (or null) must show no struck-out price and no negative "Save".
- Two features with the same section+label must 409, not create a duplicate row.
- Deleting a feature or a plan must cascade its values; deleting a plan with subscribers is still refused.
- API down / zero plans on the marketing site still shows the existing "unavailable" / "being finalised" cards (never a fabricated price).
- Renaming a plan must not orphan its values (values are keyed by id in the DB; by name only on the public wire).

---

## File Structure

| File                                                                                                                     | Responsibility                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `services/api/prisma/schema.prisma` + new migration                                                                      | New columns/tables                                                               |
| `packages/types/src/shop-plan.ts`, `index.ts`                                                                            | `PlanDefinitionResponse` extension, `PlanFeatureResponse`, `PublicPlansResponse` |
| `packages/validation/src/admin/plan-definition.schema.ts` (+test), `plan-feature.schema.ts` (+test), `index.ts`          | Zod input schemas                                                                |
| `services/api/src/shop-plan/plan-definition-response.ts`                                                                 | Mappers (admin + public)                                                         |
| `services/api/src/shop-plan/plan-definition.service.ts`                                                                  | Create/update with values; list ordering; `listPublic`                           |
| `services/api/src/shop-plan/plan-feature.service.ts`, `plan-features.controller.ts`, `dto/plan-feature.dto.ts`           | Feature row CRUD                                                                 |
| `services/api/src/audit/audit-action.ts`                                                                                 | New audit actions                                                                |
| `services/api/src/shop-plan/plan-catalog.ts` (+spec), `services/api/prisma/seed-plans.ts`                                | Seed data + script                                                               |
| `packages/api-client/src/resources/plan.resource.ts`                                                                     | Client methods + body types                                                      |
| `apps/shop-web/src/lib/plan-form.ts` (+test), `components/admin/plans-screen.tsx`, `plan-features-panel.tsx`             | Admin UI                                                                         |
| `apps/marketing-web/src/lib/plans.ts` (+test), `components/sections/Pricing.tsx`, `PricingPlans.tsx`, `CompareTable.tsx` | Public rendering                                                                 |
| delete `apps/marketing-web/src/content/pricing.ts`, `lib/pricing.ts`, `lib/pricing.test.ts`                              | Remove hard-coded plans                                                          |

---

### Task 1: Database schema + migration

**Files:**

- Modify: `services/api/prisma/schema.prisma` (model `PlanDefinition`, ~line 1582)
- Create: `services/api/prisma/migrations/20261011100000_plan_pricing_features/migration.sql`

**Interfaces:**

- Produces: Prisma models `PlanFeature` (`id, section, label, sortOrder, showOnCard, cardText, createdAt, updatedAt`), `PlanFeatureValue` (`planId, featureId, value`), and `PlanDefinition` fields `annualPriceMinor Int?`, `highlighted`, `contactOnly`, `sortOrder`, relation `featureValues`.

- [ ] **Step 1: Edit the schema.** Replace the `PlanDefinition` model with:

```prisma
model PlanDefinition {
  id                String   @id @default(uuid())
  name              String   @unique
  priceMinor        Int      @map("price_minor")
  currency          String
  billingPeriodDays Int      @map("billing_period_days")
  description       String?
  archived          Boolean  @default(false)
  // Price for 365 days; null = no annual option. The struck-out "monthly x 12" price
  // is computed by the marketing site, never stored.
  annualPriceMinor  Int?     @map("annual_price_minor")
  // "Most popular" badge + emphasised card.
  highlighted       Boolean  @default(false)
  // Custom pricing: card shows "Custom pricing" + "Contact us"; price_minor is ignored.
  contactOnly       Boolean  @default(false) @map("contact_only")
  sortOrder         Int      @default(0) @map("sort_order")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at")

  shopPlans     ShopPlan[]
  featureValues PlanFeatureValue[]

  @@map("plan_definitions")
}

// A row of the public Compare plans table ("Printers", "Audit log", ...), defined once;
// each plan sets a value per row in plan_feature_values.
model PlanFeature {
  id         String   @id @default(uuid())
  section    String
  label      String
  sortOrder  Int      @default(0) @map("sort_order")
  // Also list this row as a bullet on each plan's pricing card.
  showOnCard Boolean  @default(false) @map("show_on_card")
  // Card bullet template, e.g. "{value} printers"; null = "<label>" for a tick and
  // "<label>: <value>" for text.
  cardText   String?  @map("card_text")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at")

  values PlanFeatureValue[]

  @@unique([section, label])
  @@map("plan_features")
}

// "true" = tick, "false" = dash, anything else = the text shown (e.g. "10", "Unlimited").
// A missing row renders as a dash.
model PlanFeatureValue {
  planId    String @map("plan_id")
  featureId String @map("feature_id")
  value     String

  plan    PlanDefinition @relation(fields: [planId], references: [id], onDelete: Cascade)
  feature PlanFeature    @relation(fields: [featureId], references: [id], onDelete: Cascade)

  @@id([planId, featureId])
  @@index([featureId])
  @@map("plan_feature_values")
}
```

- [ ] **Step 2: Write the migration by hand** (`migration.sql`):

```sql
-- Admin-managed pricing: annual price, "Most popular", contact-only (custom pricing),
-- display order, and the shared feature rows + per-plan values behind the public
-- Compare plans table. Creates no plans or features (seed-plans.ts does, on request).
ALTER TABLE "plan_definitions"
  ADD COLUMN "annual_price_minor" INTEGER,
  ADD COLUMN "highlighted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contact_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "plan_definitions_annual_price_non_negative"
    CHECK ("annual_price_minor" IS NULL OR "annual_price_minor" >= 0);

CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "show_on_card" BOOLEAN NOT NULL DEFAULT false,
    "card_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_features_section_not_blank" CHECK (length(btrim("section")) > 0),
    CONSTRAINT "plan_features_label_not_blank" CHECK (length(btrim("label")) > 0)
);

CREATE UNIQUE INDEX "plan_features_section_label_key" ON "plan_features"("section", "label");

CREATE TABLE "plan_feature_values" (
    "plan_id" TEXT NOT NULL,
    "feature_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "plan_feature_values_pkey" PRIMARY KEY ("plan_id", "feature_id"),
    CONSTRAINT "plan_feature_values_value_not_blank" CHECK (length(btrim("value")) > 0)
);

CREATE INDEX "plan_feature_values_feature_id_idx" ON "plan_feature_values"("feature_id");

ALTER TABLE "plan_feature_values" ADD CONSTRAINT "plan_feature_values_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plan_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_feature_values" ADD CONSTRAINT "plan_feature_values_feature_id_fkey"
  FOREIGN KEY ("feature_id") REFERENCES "plan_features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply and regenerate.** Run from `services/api`:
      `pnpm exec prisma migrate deploy` then `pnpm exec prisma generate`.
      Expected: migration `20261011100000_plan_pricing_features` applied.

- [ ] **Step 4: Drift check (no shadow DB).** Run:
      `pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
      Expected: exit 0, "No difference detected". If it prints differences, fix the SQL (e.g. index/constraint names) until clean.

- [ ] **Step 5: Commit**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20261011100000_plan_pricing_features
git commit -m "plans: schema for annual price, badge, contact-only and feature rows" -- services/api/prisma/schema.prisma services/api/prisma/migrations/20261011100000_plan_pricing_features
```

---

### Task 2: Shared types and validation schemas

**Files:**

- Modify: `packages/types/src/shop-plan.ts`, `packages/types/src/index.ts:74`
- Modify: `packages/validation/src/admin/plan-definition.schema.ts`, `packages/validation/src/admin/index.ts`, `packages/validation/src/index.ts:96-103`
- Create: `packages/validation/src/admin/plan-feature.schema.ts`, `packages/validation/src/admin/plan-feature.schema.test.ts`
- Test: `packages/validation/src/admin/plan-definition.schema.test.ts`

**Interfaces:**

- Produces (types): `PlanDefinitionResponse` gains `annualPriceMinor: number | null; highlighted: boolean; contactOnly: boolean; sortOrder: number; values: Record<string, string>` (featureId -> value). New `PlanFeatureResponse { id; section; label; sortOrder; showOnCard; cardText: string | null }`. New `PublicPlan { name; description: string | null; priceMinor; currency; billingPeriodDays; annualPriceMinor: number | null; highlighted; contactOnly }`, `PublicPlanFeature { section; label; showOnCard; cardText: string | null; values: Record<string, string> }` (keyed by plan **name**), `PublicPlansResponse { items: PublicPlan[]; features: PublicPlanFeature[] }`.
- Produces (validation): `createPlanDefinitionSchema`/`updatePlanDefinitionSchema` accept optional `annualPriceMinor`, `highlighted`, `contactOnly`, `sortOrder`, `values`; `createPlanFeatureSchema`, `updatePlanFeatureSchema` + `CreatePlanFeatureInput`, `UpdatePlanFeatureInput`.

- [ ] **Step 1: Write failing tests.** Append to `plan-definition.schema.test.ts`:

```ts
describe("plan pricing fields", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts annual price, badge, contact-only, sort order and values", () => {
    const result = createPlanDefinitionSchema.safeParse({
      ...valid(),
      annualPriceMinor: 6_000_000,
      highlighted: true,
      contactOnly: false,
      sortOrder: 20,
      values: { [uuid]: "10" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a values key that is not a uuid, and a blank value", () => {
    expect(
      createPlanDefinitionSchema.safeParse({ ...valid(), values: { nope: "1" } }).success,
    ).toBe(false);
    expect(
      createPlanDefinitionSchema.safeParse({ ...valid(), values: { [uuid]: "  " } }).success,
    ).toBe(false);
  });

  it("update: annualPriceMinor null clears it", () => {
    const result = updatePlanDefinitionSchema.safeParse({ annualPriceMinor: null });
    expect(result.success && result.data.annualPriceMinor).toBeNull();
  });

  it("rejects a negative annual price and an out-of-range sort order", () => {
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), annualPriceMinor: -1 }).success).toBe(
      false,
    );
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), sortOrder: 1001 }).success).toBe(
      false,
    );
  });
});
```

Create `plan-feature.schema.test.ts`:

```ts
import { createPlanFeatureSchema, updatePlanFeatureSchema } from "./plan-feature.schema.js";

describe("plan feature schemas", () => {
  const valid = {
    section: "Capacity",
    label: "Printers",
    sortOrder: 10,
    showOnCard: true,
    cardText: "{value} printers",
  };

  it("accepts a full row and trims text", () => {
    const r = createPlanFeatureSchema.safeParse({
      ...valid,
      section: "  Capacity ",
      label: " Printers ",
    });
    expect(r.success && r.data.section).toBe("Capacity");
    expect(r.success && r.data.label).toBe("Printers");
  });

  it("requires section and label; the rest is optional", () => {
    expect(createPlanFeatureSchema.safeParse({ section: "A", label: "B" }).success).toBe(true);
    expect(createPlanFeatureSchema.safeParse({ section: "", label: "B" }).success).toBe(false);
    expect(createPlanFeatureSchema.safeParse({ section: "A", label: "" }).success).toBe(false);
  });

  it("update is partial and lets cardText be cleared with null", () => {
    expect(updatePlanFeatureSchema.safeParse({}).success).toBe(true);
    const r = updatePlanFeatureSchema.safeParse({ cardText: null });
    expect(r.success && r.data.cardText).toBeNull();
  });

  it("does not let a client smuggle in an id", () => {
    const r = createPlanFeatureSchema.safeParse({ ...valid, id: "x" });
    expect(r.success && "id" in r.data).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** From `packages/validation`: `timeout 120 npx jest src/admin/plan-definition.schema.test.ts src/admin/plan-feature.schema.test.ts` -> FAIL (missing module / fields).

- [ ] **Step 3: Implement.** In `plan-definition.schema.ts` add shared pieces above `createPlanDefinitionSchema`:

```ts
/** "true" = tick, "false" = dash, anything else is the text shown. */
export const planFeatureValueSchema = z.string().trim().min(1).max(60);
export const planValuesSchema = z.record(z.string().uuid(), planFeatureValueSchema);
const annualPrice = z.number().int().min(0).max(100_000_000);
const sortOrder = z.number().int().min(0).max(1000);
```

Add to `createPlanDefinitionSchema`: `annualPriceMinor: annualPrice.optional(), highlighted: z.boolean().optional(), contactOnly: z.boolean().optional(), sortOrder: sortOrder.optional(), values: planValuesSchema.optional(),`.
Add to `updatePlanDefinitionSchema`: `annualPriceMinor: annualPrice.nullable().optional(), highlighted: z.boolean().optional(), contactOnly: z.boolean().optional(), sortOrder: sortOrder.optional(), values: planValuesSchema.optional(),`.

Create `plan-feature.schema.ts`:

```ts
import { z } from "zod";

const section = z.string().trim().min(1).max(60);
const label = z.string().trim().min(1).max(100);
const sortOrder = z.number().int().min(0).max(1000);
const cardText = z.string().trim().min(1).max(120);

export const createPlanFeatureSchema = z.object({
  section,
  label,
  sortOrder: sortOrder.optional(),
  showOnCard: z.boolean().optional(),
  cardText: cardText.optional(),
});
export type CreatePlanFeatureInput = z.infer<typeof createPlanFeatureSchema>;

export const updatePlanFeatureSchema = z.object({
  section: section.optional(),
  label: label.optional(),
  sortOrder: sortOrder.optional(),
  showOnCard: z.boolean().optional(),
  cardText: cardText.nullable().optional(),
});
export type UpdatePlanFeatureInput = z.infer<typeof updatePlanFeatureSchema>;
```

Export both from `packages/validation/src/admin/index.ts` and re-export (`createPlanFeatureSchema, type CreatePlanFeatureInput, updatePlanFeatureSchema, type UpdatePlanFeatureInput`) from `packages/validation/src/index.ts` next to the plan-definition exports.

In `packages/types/src/shop-plan.ts` extend `PlanDefinitionResponse` with the five fields (doc-comment each) and append:

```ts
export interface PlanFeatureResponse {
  id: string;
  section: string;
  label: string;
  sortOrder: number;
  showOnCard: boolean;
  cardText: string | null;
}

export interface PublicPlan {
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  billingPeriodDays: number;
  annualPriceMinor: number | null;
  highlighted: boolean;
  contactOnly: boolean;
}

/** One Compare-table row; `values` is keyed by plan NAME (unique), a missing key = dash. */
export interface PublicPlanFeature {
  section: string;
  label: string;
  showOnCard: boolean;
  cardText: string | null;
  values: Record<string, string>;
}

export interface PublicPlansResponse {
  items: PublicPlan[];
  features: PublicPlanFeature[];
}
```

Export `PlanFeatureResponse, PublicPlan, PublicPlanFeature, PublicPlansResponse` from `packages/types/src/index.ts` (line 74).

- [ ] **Step 4: Run, expect PASS** (same command, plus `npx tsc --noEmit` in `packages/validation` and `packages/types`). Note: other packages now fail typecheck until Tasks 4-9 land; that is expected.

- [ ] **Step 5: Commit** the listed files (explicit pathspecs), message `plans: shared types and validation for pricing fields and feature rows`.

---

### Task 3: Plan definition mappers + service (new fields and values)

**Files:**

- Modify: `services/api/src/shop-plan/plan-definition-response.ts`, `services/api/src/shop-plan/plan-definition.service.ts`
- Test: `services/api/test/plan-definitions.e2e-spec.ts` (update the `PlanBody` interface and the `toEqual(created)` expectation; add cases below)

**Interfaces:**

- Consumes: Task 1 models, Task 2 types/schemas.
- Produces: `PlanDefinitionService.create/update` honour the new fields; `PlanDefinitionResponse.values`; error `PLAN_FEATURE_NOT_FOUND` (400) for unknown feature ids.

- [ ] **Step 1: Write failing e2e cases** in `plan-definitions.e2e-spec.ts`. Add `annualPriceMinor: number | null; highlighted: boolean; contactOnly: boolean; sortOrder: number; values: Record<string, string>;` to `PlanBody`, extend the existing created `toEqual` with `annualPriceMinor: null, highlighted: false, contactOnly: false, sortOrder: 0, values: {}`, and add a feature helper + describe block:

```ts
const featureIds: string[] = [];
async function createFeature(section: string, label: string): Promise<string> {
  const res = await http()
    .post("/v1/admin/plan-features")
    .set(admin())
    .send({ section, label: `${label} ${randomUUID()}` });
  expect(res.status).toBe(201);
  featureIds.push(res.body.id as string);
  return res.body.id as string;
}
```

(add `await fx.prisma.planFeature.deleteMany({ where: { id: { in: featureIds } } });` to `afterAll` before deleting plans), then:

```ts
describe("pricing fields and feature values", () => {
  it("stores annual price, badge, contact-only, sort order and values; replaces values on update", async () => {
    const a = await createFeature("Capacity", "Printers");
    const b = await createFeature("Support", "Support");
    const plan = await createPlan({
      annualPriceMinor: 6_000_000,
      highlighted: true,
      sortOrder: 20,
      values: { [a]: "10", [b]: "true" },
    });
    expect(plan).toMatchObject({
      annualPriceMinor: 6_000_000,
      highlighted: true,
      contactOnly: false,
      sortOrder: 20,
      values: { [a]: "10", [b]: "true" },
    });

    const patched = await http()
      .patch(`/v1/admin/plans/${plan.id}`)
      .set(admin())
      .send({ annualPriceMinor: null, values: { [a]: "Unlimited" } });
    expect(patched.status).toBe(200);
    expect(patched.body.annualPriceMinor).toBeNull();
    expect(patched.body.values).toEqual({ [a]: "Unlimited" }); // b removed: replace, not merge
  });

  it("rejects values for a feature that does not exist (400, not 500)", async () => {
    const res = await http()
      .post("/v1/admin/plans")
      .set(admin())
      .send({
        name: `Bad ${randomUUID()}`,
        priceMinor: 1,
        currency: "PKR",
        billingPeriodDays: 30,
        values: { [randomUUID()]: "1" },
      });
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code).toBe("PLAN_FEATURE_NOT_FOUND");
  });

  it("lists by sortOrder then price, and deleting a plan cascades its values", async () => {
    const f = await createFeature("Capacity", "Orders");
    const second = await createPlan({ sortOrder: 2, values: { [f]: "5" } });
    const first = await createPlan({ sortOrder: 1 });
    const ids = (await http().get("/v1/admin/plans").set(admin())).body.items.map(
      (p: PlanBody) => p.id,
    );
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect((await http().delete(`/v1/admin/plans/${second.id}`).set(admin())).status).toBe(200);
    expect(await fx.prisma.planFeatureValue.count({ where: { planId: second.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** From `services/api`: `timeout 600 npx jest --config jest.e2e.config.cjs test/plan-definitions.e2e-spec.ts` -> FAIL (fields missing / route 404).

- [ ] **Step 3: Implement the mappers.** In `plan-definition-response.ts` change the include and mappers:

```ts
export const PLAN_DEFINITION_WITH_COUNT = {
  _count: { select: { shopPlans: true } },
  featureValues: true,
} satisfies Prisma.PlanDefinitionInclude;
```

In `toPlanDefinitionResponse` add:

```ts
    annualPriceMinor: row.annualPriceMinor,
    highlighted: row.highlighted,
    contactOnly: row.contactOnly,
    sortOrder: row.sortOrder,
    values: Object.fromEntries(row.featureValues.map((v) => [v.featureId, v.value])),
```

Replace `PublicPlanResponse`/`toPublicPlanResponse` with the Task 2 `PublicPlan` shape (import type from `@print-automated/types`; keep the function name `toPublicPlanResponse`, add `annualPriceMinor`, `highlighted`, `contactOnly` to its `Pick` and return object). Delete the local `PublicPlanResponse` interface and update the import in `public-plans.controller.ts` in Task 5.

- [ ] **Step 4: Implement the service.** In `plan-definition.service.ts`:
  - Add `"annualPriceMinor", "highlighted", "contactOnly", "sortOrder"` to `EDITABLE` (before `"archived"`) and to `snapshot`.
  - Add the exception:
    ```ts
    const FEATURE_NOT_FOUND = (): AppException =>
      new AppException(
        HttpStatus.BAD_REQUEST,
        "PLAN_FEATURE_NOT_FOUND",
        "One of the feature rows does not exist. Refresh and try again.",
        false,
      );
    ```
  - Add a private helper used by create and update:
    ```ts
    /** Replaces a plan's values atomically. Every featureId must exist (400 otherwise). */
    private async replaceValues(tx: Prisma.TransactionClient, planId: string, values: Record<string, string>): Promise<void> {
      const ids = Object.keys(values);
      if (ids.length > 0 && (await tx.planFeature.count({ where: { id: { in: ids } } })) !== ids.length) {
        throw FEATURE_NOT_FOUND();
      }
      await tx.planFeatureValue.deleteMany({ where: { planId } });
      if (ids.length > 0) {
        await tx.planFeatureValue.createMany({
          data: ids.map((featureId) => ({ planId, featureId, value: values[featureId]! })),
        });
      }
    }
    ```
  - `create`: add `annualPriceMinor: input.annualPriceMinor ?? null, highlighted: input.highlighted ?? false, contactOnly: input.contactOnly ?? false, sortOrder: input.sortOrder ?? 0` to `data`; after the `create` call, `if (input.values) await this.replaceValues(tx, row.id, input.values);` then re-read with `tx.planDefinition.findUniqueOrThrow({ where: { id: row.id }, include: PLAN_DEFINITION_WITH_COUNT })` for the response and audit `after: snapshot(row)` plus `values: input.values ?? {}`.
  - `update`: after the EDITABLE loop and before the `changedKeys.length > 0` block, add
    Read `const beforeValues = Object.fromEntries((await tx.planFeatureValue.findMany({ where: { planId: id } })).map((v) => [v.featureId, v.value]));`; if `input.values !== undefined` and `JSON.stringify(sortKeys(input.values)) !== JSON.stringify(sortKeys(beforeValues))` then `await this.replaceValues(tx, id, input.values)`, push `"values"` onto `changedKeys`. Define `const sortKeys = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));` at module level. The audit `pick` must handle the `values` key: build `before`/`after` for it from `beforeValues`/`input.values`. Update the `data` update call to run only when at least one non-`values` key changed (`const rowKeys = changedKeys.filter((k) => k !== "values")`).
  - `list` ordering: `[{ archived: "asc" }, { sortOrder: "asc" }, { priceMinor: "asc" }, { name: "asc" }]`.
  - `remove` needs no change (FK cascade deletes values).

- [ ] **Step 5: Run, expect PASS** (same jest command), then `npx tsc --noEmit` in `services/api`.

- [ ] **Step 6: Commit** `plan-definition-response.ts`, `plan-definition.service.ts`, `plan-definitions.e2e-spec.ts` (note: `plan-features` route used by the e2e helper lands in Task 4, so run Task 4 before the e2e run if executing strictly in order; commit both tasks' files separately).

---

### Task 4: Feature row CRUD (service, controller, audit)

**Files:**

- Create: `services/api/src/shop-plan/plan-feature.service.ts`, `services/api/src/shop-plan/plan-features.controller.ts`, `services/api/src/shop-plan/dto/plan-feature.dto.ts`
- Modify: `services/api/src/shop-plan/shop-plan.module.ts`, `services/api/src/audit/audit-action.ts:89-91`
- Test: `services/api/test/plan-definitions.e2e-spec.ts` (new describe)

**Interfaces:**

- Consumes: Task 2 schemas.
- Produces: `GET/POST /v1/admin/plan-features`, `PATCH/DELETE /v1/admin/plan-features/:id`; `PlanFeatureService` (`list`, `create`, `update`, `remove`); 409 `PLAN_FEATURE_TAKEN`.

- [ ] **Step 1: Write failing e2e cases** (add before running Task 3's suite):

```ts
describe("plan feature rows", () => {
  it("create/list/patch/delete, ordered by sortOrder, audited, 409 on duplicate section+label", async () => {
    const label = `Row ${randomUUID()}`;
    const created = await http().post("/v1/admin/plan-features").set(admin()).send({
      section: "Capacity",
      label,
      sortOrder: 5,
      showOnCard: true,
      cardText: "{value} things",
    });
    expect(created.status).toBe(201);
    featureIds.push(created.body.id as string);
    expect(created.body).toEqual({
      id: expect.any(String),
      section: "Capacity",
      label,
      sortOrder: 5,
      showOnCard: true,
      cardText: "{value} things",
    });

    const dup = await http()
      .post("/v1/admin/plan-features")
      .set(admin())
      .send({ section: "Capacity", label });
    expect(dup.status).toBe(409);
    expect(dup.body.code ?? dup.body.error?.code).toBe("PLAN_FEATURE_TAKEN");

    const patched = await http()
      .patch(`/v1/admin/plan-features/${created.body.id}`)
      .set(admin())
      .send({ cardText: null });
    expect(patched.status).toBe(200);
    expect(patched.body.cardText).toBeNull();

    const list = await http().get("/v1/admin/plan-features").set(admin());
    expect(list.body.items.map((f: { id: string }) => f.id)).toContain(created.body.id);

    expect(
      (await http().delete(`/v1/admin/plan-features/${created.body.id}`).set(admin())).status,
    ).toBe(200);
    expect(
      await fx.prisma.auditLog.count({
        where: { resourceId: created.body.id, resourceType: "plan_feature" },
      }),
    ).toBe(3);
  });

  it("is ADMIN only", async () => {
    expect((await http().get("/v1/admin/plan-features").set(owner())).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (404 on the routes).

- [ ] **Step 3: Implement.** Add to `audit-action.ts` after `PLAN_DEFINITION_DELETED`: `PLAN_FEATURE_CREATED: "PLAN_FEATURE_CREATED", PLAN_FEATURE_UPDATED: "PLAN_FEATURE_UPDATED", PLAN_FEATURE_DELETED: "PLAN_FEATURE_DELETED",`.

`dto/plan-feature.dto.ts`:

```ts
import { createZodDto } from "nestjs-zod";
import { createPlanFeatureSchema, updatePlanFeatureSchema } from "@print-automated/validation";

export class CreatePlanFeatureDto extends createZodDto(createPlanFeatureSchema) {}
export class UpdatePlanFeatureDto extends createZodDto(updatePlanFeatureSchema) {}
```

`plan-feature.service.ts`:

```ts
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type PlanFeature } from "@prisma/client";
import { AppException, PrismaService, redactMetadata } from "@print-automated/backend-shared";
import type { PlanFeatureResponse } from "@print-automated/types";
import type { CreatePlanFeatureInput, UpdatePlanFeatureInput } from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";

const NOT_FOUND = (): AppException =>
  new AppException(HttpStatus.NOT_FOUND, "PLAN_FEATURE_NOT_FOUND", "No such feature row.", false);
const TAKEN = (): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PLAN_FEATURE_TAKEN",
    "A feature with this section and label already exists.",
    false,
  );

export const toPlanFeatureResponse = (row: PlanFeature): PlanFeatureResponse => ({
  id: row.id,
  section: row.section,
  label: row.label,
  sortOrder: row.sortOrder,
  showOnCard: row.showOnCard,
  cardText: row.cardText,
});

const isUnique = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Rows of the public Compare plans table. Deleting one deletes every plan's value for it. */
@Injectable()
export class PlanFeatureService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ items: PlanFeatureResponse[] }> {
    const rows = await this.prisma.planFeature.findMany({
      orderBy: [{ sortOrder: "asc" }, { section: "asc" }, { label: "asc" }],
    });
    return { items: rows.map(toPlanFeatureResponse) };
  }

  async create(actorId: string, input: CreatePlanFeatureInput): Promise<PlanFeatureResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.planFeature.create({
          data: {
            section: input.section,
            label: input.label,
            sortOrder: input.sortOrder ?? 0,
            showOnCard: input.showOnCard ?? false,
            cardText: input.cardText ?? null,
          },
        });
        await this.audit(tx, actorId, AuditAction.PLAN_FEATURE_CREATED, row.id, {
          after: toPlanFeatureResponse(row),
        });
        return toPlanFeatureResponse(row);
      });
    } catch (e) {
      throw isUnique(e) ? TAKEN() : e;
    }
  }

  async update(
    actorId: string,
    id: string,
    input: UpdatePlanFeatureInput,
  ): Promise<PlanFeatureResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.planFeature.findUnique({ where: { id } });
        if (!before) throw NOT_FOUND();
        const after = await tx.planFeature.update({
          where: { id },
          data: {
            ...(input.section !== undefined && { section: input.section }),
            ...(input.label !== undefined && { label: input.label }),
            ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
            ...(input.showOnCard !== undefined && { showOnCard: input.showOnCard }),
            ...(input.cardText !== undefined && { cardText: input.cardText }),
          },
        });
        await this.audit(tx, actorId, AuditAction.PLAN_FEATURE_UPDATED, id, {
          before: toPlanFeatureResponse(before),
          after: toPlanFeatureResponse(after),
        });
        return toPlanFeatureResponse(after);
      });
    } catch (e) {
      throw isUnique(e) ? TAKEN() : e;
    }
  }

  async remove(actorId: string, id: string): Promise<{ result: "DELETED" }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.planFeature.findUnique({ where: { id } });
      if (!before) throw NOT_FOUND();
      await tx.planFeature.delete({ where: { id } });
      await this.audit(tx, actorId, AuditAction.PLAN_FEATURE_DELETED, id, {
        before: toPlanFeatureResponse(before),
      });
    });
    return { result: "DELETED" };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: "plan_feature",
        resourceId,
        metadata: redactMetadata(metadata) as Prisma.InputJsonValue,
      },
    });
  }
}
```

`plan-features.controller.ts` (same guards/decorators as `PlanDefinitionsController`):

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { PlanFeatureResponse } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { CreatePlanFeatureDto, UpdatePlanFeatureDto } from "./dto/plan-feature.dto.js";
import { PlanFeatureService } from "./plan-feature.service.js";

@Controller("admin/plan-features")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PlanFeaturesController {
  constructor(private readonly features: PlanFeatureService) {}

  @Get()
  list(): Promise<{ items: PlanFeatureResponse[] }> {
    return this.features.list();
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreatePlanFeatureDto,
  ): Promise<PlanFeatureResponse> {
    return this.features.create(req.user!.id, dto);
  }

  @Patch(":id")
  update(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanFeatureDto,
  ): Promise<PlanFeatureResponse> {
    return this.features.update(req.user!.id, id, dto);
  }

  @Delete(":id")
  remove(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ result: "DELETED" }> {
    return this.features.remove(req.user!.id, id);
  }
}
```

Register in `shop-plan.module.ts`: add `PlanFeaturesController` to `controllers` and `PlanFeatureService` to `providers`.

- [ ] **Step 4: Run, expect PASS** (the whole `plan-definitions.e2e-spec.ts`, Tasks 3 and 4 together) and `npx tsc --noEmit`.

- [ ] **Step 5: Commit** the files above (pathspecs), message `plans: admin CRUD for Compare-table feature rows`.

---

### Task 5: Public `GET /v1/plans` returns plans + features

**Files:**

- Modify: `services/api/src/shop-plan/plan-definition.service.ts` (`listPublic`), `services/api/src/shop-plan/public-plans.controller.ts`
- Test: `services/api/test/plan-definitions.e2e-spec.ts` (extend the existing public-plans test; grep `v1/plans"` to find it)

**Interfaces:**

- Consumes: Tasks 2-4.
- Produces: `PlanDefinitionService.listPublic(): Promise<PublicPlansResponse>`; `GET /v1/plans` -> `{ items: PublicPlan[], features: PublicPlanFeature[] }`.

- [ ] **Step 1: Write failing test:**

```ts
it("public /v1/plans: ordered, excludes archived, exposes features keyed by plan name, no admin fields", async () => {
  const f = await createFeature("Capacity", "Printers");
  const live = await createPlan({
    name: `Pub ${randomUUID()}`,
    sortOrder: 1,
    highlighted: true,
    annualPriceMinor: 5_000_000,
    values: { [f]: "7" },
  });
  const gone = await createPlan({ name: `Arch ${randomUUID()}`, sortOrder: 0 });
  await http().patch(`/v1/admin/plans/${gone.id}`).set(admin()).send({ archived: true });

  const res = await http().get("/v1/plans"); // no auth header
  expect(res.status).toBe(200);
  const names = res.body.items.map((p: { name: string }) => p.name);
  expect(names).toContain(live.name);
  expect(names).not.toContain(gone.name);
  const item = res.body.items.find((p: { name: string }) => p.name === live.name);
  expect(item).toEqual({
    name: live.name,
    description: live.description,
    priceMinor: live.priceMinor,
    currency: "PKR",
    billingPeriodDays: 30,
    annualPriceMinor: 5_000_000,
    highlighted: true,
    contactOnly: false,
  });
  const row = res.body.features.find((x: { label: string }) => x.label.startsWith("Printers"));
  expect(row.values[live.name]).toBe("7");
  expect(Object.keys(row.values)).not.toContain(gone.name);
  expect(JSON.stringify(res.body)).not.toMatch(/subscriberCount|archived|createdAt/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Replace `listPublic`:

```ts
  /** The public pricing payload: live plans in the admin's order, plus every feature row with each
   * live plan's value (keyed by plan name). Archived plans and their values are excluded. */
  async listPublic(): Promise<PublicPlansResponse> {
    const [plans, features] = await Promise.all([
      this.prisma.planDefinition.findMany({
        where: { archived: false },
        include: { featureValues: true },
        orderBy: [{ sortOrder: "asc" }, { priceMinor: "asc" }, { name: "asc" }],
      }),
      this.prisma.planFeature.findMany({
        orderBy: [{ sortOrder: "asc" }, { section: "asc" }, { label: "asc" }],
      }),
    ]);
    return {
      items: plans.map(toPublicPlanResponse),
      features: features.map((feature) => ({
        section: feature.section,
        label: feature.label,
        showOnCard: feature.showOnCard,
        cardText: feature.cardText,
        values: Object.fromEntries(
          plans.flatMap((plan) => {
            const hit = plan.featureValues.find((v) => v.featureId === feature.id);
            return hit ? [[plan.name, hit.value] as const] : [];
          }),
        ),
      })),
    };
  }
```

(import `PublicPlansResponse` from `@print-automated/types`; drop the old `PublicPlanResponse` import). In `public-plans.controller.ts`: `list(): Promise<PublicPlansResponse> { return this.plans.listPublic(); }` with the type imported from `@print-automated/types`.

- [ ] **Step 4: Run, expect PASS** (full file) + `npx tsc --noEmit`.

- [ ] **Step 5: Commit** (`plan-definition.service.ts`, `public-plans.controller.ts`, e2e spec), message `plans: public pricing endpoint returns feature rows and per-plan values`.

---

### Task 6: Seed catalog and script

**Files:**

- Create: `services/api/src/shop-plan/plan-catalog.ts`, `services/api/src/shop-plan/plan-catalog.spec.ts`, `services/api/prisma/seed-plans.ts`
- Modify: `services/api/package.json` (script `"prisma:seed-plans": "tsx prisma/seed-plans.ts"`)

**Interfaces:**

- Produces: `FEATURE_CATALOG: CatalogFeature[]`, `PLAN_CATALOG: CatalogPlan[]` (values keyed by feature `key`); `seedPlans(prisma)` creating only what is missing.

- [ ] **Step 1: Write the failing spec** `plan-catalog.spec.ts`:

```ts
import { FEATURE_CATALOG, PLAN_CATALOG } from "./plan-catalog.js";

describe("plan catalog", () => {
  const keys = new Set(FEATURE_CATALOG.map((f) => f.key));

  it("has unique feature keys and unique section+label", () => {
    expect(keys.size).toBe(FEATURE_CATALOG.length);
    expect(new Set(FEATURE_CATALOG.map((f) => `${f.section}|${f.label}`)).size).toBe(
      FEATURE_CATALOG.length,
    );
  });

  it("every plan value refers to a defined feature and no plan misses a row", () => {
    for (const plan of PLAN_CATALOG) {
      for (const key of Object.keys(plan.values)) expect(keys.has(key)).toBe(true);
      for (const key of keys) expect(plan.values[key]).toBeDefined();
    }
  });

  it("paid plans are PKR with annual = 10x monthly; enterprise is contact-only", () => {
    const paid = PLAN_CATALOG.filter((p) => !p.contactOnly);
    expect(paid.map((p) => p.name)).toEqual(["Starter", "Growth", "Business"]);
    expect(paid.map((p) => p.priceMinor)).toEqual([600_000, 1_100_000, 1_500_000]);
    expect(paid.map((p) => p.annualPriceMinor)).toEqual([6_000_000, 11_000_000, 15_000_000]);
    for (const p of paid) {
      expect(p.currency).toBe("PKR");
      expect(p.annualPriceMinor).toBe(p.priceMinor * 10);
    }
    const ent = PLAN_CATALOG.find((p) => p.name === "Enterprise")!;
    expect(ent.contactOnly).toBe(true);
    expect(new Set(Object.values(ent.values))).toEqual(new Set(["Custom"]));
  });

  it("only Growth is highlighted", () => {
    expect(PLAN_CATALOG.filter((p) => p.highlighted).map((p) => p.name)).toEqual(["Growth"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`timeout 120 npx jest src/shop-plan/plan-catalog.spec.ts` in `services/api`).

- [ ] **Step 3: Implement `plan-catalog.ts`:**

```ts
export interface CatalogFeature {
  key: string;
  section: string;
  label: string;
  showOnCard: boolean;
  cardText?: string;
}

export interface CatalogPlan {
  name: string;
  description: string;
  priceMinor: number;
  annualPriceMinor: number | null;
  currency: string;
  billingPeriodDays: number;
  highlighted: boolean;
  contactOnly: boolean;
  /** feature key -> "true" | "false" | text */
  values: Record<string, string>;
}

/** The launch pricing table (owner-supplied 2026-10-11). Loaded once by `prisma:seed-plans`;
 * after that the admin panel owns it. Order here = display order (sort_order = index * 10). */
export const FEATURE_CATALOG: CatalogFeature[] = [
  {
    key: "printers",
    section: "Capacity",
    label: "Printers",
    showOnCard: true,
    cardText: "{value} printers",
  },
  {
    key: "staff",
    section: "Capacity",
    label: "Staff users",
    showOnCard: true,
    cardText: "{value} staff users",
  },
  {
    key: "orders",
    section: "Capacity",
    label: "Orders per month",
    showOnCard: true,
    cardText: "{value} orders per month",
  },
  { key: "routing", section: "Automation", label: "Automatic printer routing", showOnCard: true },
  {
    key: "allocation",
    section: "Automation",
    label: "Smart allocation and auto-failover",
    showOnCard: true,
  },
  { key: "rules", section: "Automation", label: "Custom automation rules", showOnCard: true },
  {
    key: "daily",
    section: "Reporting",
    label: "Daily reports",
    showOnCard: true,
    cardText: "Essential daily reports",
  },
  {
    key: "revenue",
    section: "Reporting",
    label: "Inventory and revenue reports",
    showOnCard: true,
  },
  { key: "exports", section: "Reporting", label: "Data exports and API access", showOnCard: true },
  { key: "audit", section: "Reporting", label: "Audit log", showOnCard: false },
  { key: "support", section: "Support", label: "Support", showOnCard: false },
];

const T = "true";
const F = "false";

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    name: "Starter",
    description: "For a single-counter shop getting its first orders online.",
    priceMinor: 600_000,
    annualPriceMinor: 6_000_000,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: false,
    contactOnly: false,
    values: {
      printers: "2",
      staff: "3",
      orders: "300",
      routing: T,
      allocation: F,
      rules: F,
      daily: T,
      revenue: F,
      exports: F,
      audit: F,
      support: "Email",
    },
  },
  {
    name: "Growth",
    description: "For busy shops that want the queue to run itself.",
    priceMinor: 1_100_000,
    annualPriceMinor: 11_000_000,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: true,
    contactOnly: false,
    values: {
      printers: "10",
      staff: "15",
      orders: "2,000",
      routing: T,
      allocation: T,
      rules: F,
      daily: T,
      revenue: T,
      exports: F,
      audit: T,
      support: "Priority email",
    },
  },
  {
    name: "Business",
    description: "For multi-site operations with heavier volume.",
    priceMinor: 1_500_000,
    annualPriceMinor: 15_000_000,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: false,
    contactOnly: false,
    values: {
      printers: "Unlimited",
      staff: "Unlimited",
      orders: "10,000",
      routing: T,
      allocation: T,
      rules: T,
      daily: T,
      revenue: T,
      exports: T,
      audit: T,
      support: "Dedicated contact",
    },
  },
  {
    name: "Enterprise",
    description:
      "Everything tailored to your business: limits, features and support. Talk to our team.",
    priceMinor: 0,
    annualPriceMinor: null,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: false,
    contactOnly: true,
    values: Object.fromEntries(
      [
        "printers",
        "staff",
        "orders",
        "routing",
        "allocation",
        "rules",
        "daily",
        "revenue",
        "exports",
        "audit",
        "support",
      ].map((k) => [k, "Custom"]),
    ),
  },
];
```

- [ ] **Step 4: Run spec, expect PASS.**

- [ ] **Step 5: Write the script `prisma/seed-plans.ts`:**

```ts
import { PrismaClient } from "@prisma/client";
import { FEATURE_CATALOG, PLAN_CATALOG } from "../src/shop-plan/plan-catalog.js";

const prisma = new PrismaClient();

/** Idempotent and non-destructive: creates only the features and plans that are missing, and
 * never overwrites one that exists (an admin may have edited it). Run with
 * `pnpm --filter @print-automated/api prisma:seed-plans`. */
async function main(): Promise<void> {
  const featureIds = new Map<string, string>();
  for (const [index, f] of FEATURE_CATALOG.entries()) {
    const existing = await prisma.planFeature.findUnique({
      where: { section_label: { section: f.section, label: f.label } },
    });
    const row =
      existing ??
      (await prisma.planFeature.create({
        data: {
          section: f.section,
          label: f.label,
          sortOrder: index * 10,
          showOnCard: f.showOnCard,
          cardText: f.cardText ?? null,
        },
      }));
    featureIds.set(f.key, row.id);
    console.log(`${existing ? "kept   " : "created"} feature ${f.section} / ${f.label}`);
  }

  for (const [index, p] of PLAN_CATALOG.entries()) {
    if (await prisma.planDefinition.findUnique({ where: { name: p.name } })) {
      console.log(`kept    plan ${p.name}`);
      continue;
    }
    await prisma.planDefinition.create({
      data: {
        name: p.name,
        description: p.description,
        priceMinor: p.priceMinor,
        annualPriceMinor: p.annualPriceMinor,
        currency: p.currency,
        billingPeriodDays: p.billingPeriodDays,
        highlighted: p.highlighted,
        contactOnly: p.contactOnly,
        sortOrder: (index + 1) * 10,
        featureValues: {
          create: Object.entries(p.values).map(([key, value]) => ({
            featureId: featureIds.get(key)!,
            value,
          })),
        },
      },
    });
    console.log(`created plan ${p.name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Add the `prisma:seed-plans` script to `package.json`.

- [ ] **Step 6: Run the seed twice.** From `services/api`: `pnpm run prisma:seed-plans` then again. Expected: first run prints `created` lines; second prints only `kept`. Verify with SQL (psql or Prisma): 4 plans, 11 features, 44 `plan_feature_values` rows.

- [ ] **Step 7: Commit** (`plan-catalog.ts`, `plan-catalog.spec.ts`, `seed-plans.ts`, `package.json`), message `plans: idempotent seed for launch plans and the Compare table`.

---

### Task 7: API client

**Files:**

- Modify: `packages/api-client/src/resources/plan.resource.ts`, `packages/api-client/src/index.ts:65`

**Interfaces:**

- Consumes: Task 2 types.
- Produces: `CreatePlanDefinitionBody` gains optional `annualPriceMinor?: number; highlighted?: boolean; contactOnly?: boolean; sortOrder?: number; values?: Record<string, string>`; `UpdatePlanDefinitionBody` additionally allows `annualPriceMinor?: number | null`; new `CreatePlanFeatureBody`, `UpdatePlanFeatureBody`; `PlanResource.listFeatures/createFeature/updateFeature/deleteFeature`.

- [ ] **Step 1: Implement.** In the body types add the fields above (update body: `Omit<Partial<CreatePlanDefinitionBody>, "description" | "annualPriceMinor"> & { description?: string | null; annualPriceMinor?: number | null; archived?: boolean }`). Add:

```ts
export interface CreatePlanFeatureBody {
  section: string;
  label: string;
  sortOrder?: number;
  showOnCard?: boolean;
  cardText?: string;
}
export type UpdatePlanFeatureBody = Omit<Partial<CreatePlanFeatureBody>, "cardText"> & {
  cardText?: string | null;
};
export interface PlanFeatureListResult {
  items: PlanFeatureResponse[];
}
```

and methods on `PlanResource` (import `PlanFeatureResponse`):

```ts
  listFeatures(): Promise<PlanFeatureListResult> {
    return this.http.request<PlanFeatureListResult>("/v1/admin/plan-features");
  }
  createFeature(input: CreatePlanFeatureBody): Promise<PlanFeatureResponse> {
    return this.http.request<PlanFeatureResponse>("/v1/admin/plan-features", { method: "POST", body: input });
  }
  updateFeature(id: string, input: UpdatePlanFeatureBody): Promise<PlanFeatureResponse> {
    return this.http.request<PlanFeatureResponse>(`/v1/admin/plan-features/${id}`, { method: "PATCH", body: input });
  }
  deleteFeature(id: string): Promise<{ result: "DELETED" }> {
    return this.http.request<{ result: "DELETED" }>(`/v1/admin/plan-features/${id}`, { method: "DELETE" });
  }
```

Export the new types from `packages/api-client/src/index.ts` beside `CreatePlanDefinitionBody`.

- [ ] **Step 2: Verify.** `npx tsc --noEmit` in `packages/api-client`; expect clean.

- [ ] **Step 3: Commit** (two files), message `plans: api-client methods for feature rows and pricing fields`.

---

### Task 8: Admin UI

**Files:**

- Modify: `apps/shop-web/src/lib/plan-form.ts`, `apps/shop-web/src/lib/plan-form.test.ts`, `apps/shop-web/src/components/admin/plans-screen.tsx`, `apps/shop-web/src/components/admin/plans-screen.test.ts` (fixture gains the new `PlanDefinitionResponse` fields)
- Create: `apps/shop-web/src/components/admin/plan-features-panel.tsx`

**Interfaces:**

- Consumes: Task 7 client, Task 2 types.
- Produces: `PlanForm` gains `annualPrice: string; highlighted: boolean; contactOnly: boolean; sortOrder: string; values: Record<string, string>`; `checkPlanForm(form)` builds `CreatePlanDefinitionBody` (with `values` containing only non-dash entries); `toUpdatePlanInput` includes the new fields; pure helpers `valueMode(value)` -> `"yes" | "no" | "text"` and `modeToValue(mode, text)`.

- [ ] **Step 1: Write failing tests** in `plan-form.test.ts` (extend the `plan` fixture with `annualPriceMinor: null, highlighted: false, contactOnly: false, sortOrder: 0, values: {}`; extend `filled` with `annualPrice: "", highlighted: false, contactOnly: false, sortOrder: "0", values: {}`):

```ts
describe("pricing fields", () => {
  it("converts annual price to minor units and sends sort order, badge and values", () => {
    const check = checkPlanForm(
      filled({
        annualPrice: "25000",
        highlighted: true,
        sortOrder: "20",
        values: { f1: "true", f2: "10", f3: "false", f4: "" },
      }),
    );
    expect(check.ok && check.input).toMatchObject({
      annualPriceMinor: 2_500_000,
      highlighted: true,
      sortOrder: 20,
      values: { f1: "true", f2: "10" },
    });
    // dashes (false / empty) are NOT sent: a missing row is a dash.
    expect(check.ok && Object.keys(check.input.values ?? {})).not.toContain("f3");
  });

  it("annual price is optional (blank = none)", () => {
    const check = checkPlanForm(filled({ annualPrice: "" }));
    expect(check.ok && check.input.annualPriceMinor).toBeUndefined();
  });

  it("a contact-only plan needs no price and sends 0", () => {
    const check = checkPlanForm(filled({ contactOnly: true, price: "" }));
    expect(check.ok && check.input).toMatchObject({ contactOnly: true, priceMinor: 0 });
  });

  it("rejects a bad annual price and sort order", () => {
    expect(problemsOf(filled({ annualPrice: "abc" })).annualPrice).toBeDefined();
    expect(problemsOf(filled({ sortOrder: "-1" })).sortOrder).toBeDefined();
  });

  it("toUpdatePlanInput sends annualPriceMinor: null when the annual price is cleared", () => {
    const withAnnual = { ...plan, annualPriceMinor: 2_500_000 };
    const check = checkPlanForm({ ...planToForm(withAnnual), annualPrice: "" });
    expect(check.ok && toUpdatePlanInput(withAnnual, check.input)).toEqual({
      annualPriceMinor: null,
    });
  });

  it("toUpdatePlanInput sends values only when they changed", () => {
    const withValues = { ...plan, values: { f1: "10" } };
    const same = checkPlanForm(planToForm(withValues));
    expect(same.ok && toUpdatePlanInput(withValues, same.input)).toEqual({});
    const changed = checkPlanForm({ ...planToForm(withValues), values: { f1: "11" } });
    expect(changed.ok && toUpdatePlanInput(withValues, changed.input)).toEqual({
      values: { f1: "11" },
    });
  });
});

describe("value modes", () => {
  it.each([
    ["true", "yes"],
    ["false", "no"],
    ["", "no"],
    ["10", "text"],
    ["Unlimited", "text"],
  ] as const)("%s -> %s", (value, mode) => expect(valueMode(value)).toBe(mode));
  it("modeToValue", () => {
    expect(modeToValue("yes", "")).toBe("true");
    expect(modeToValue("no", "x")).toBe("false");
    expect(modeToValue("text", "10")).toBe("10");
  });
});
```

(import `valueMode`, `modeToValue` from `./plan-form`.)

- [ ] **Step 2: Run, expect FAIL.** From `apps/shop-web`: `timeout 300 npx jest src/lib/plan-form.test.ts`.

- [ ] **Step 3: Implement `plan-form.ts`.**
  - Add to `PlanForm`: `annualPrice: string; highlighted: boolean; contactOnly: boolean; sortOrder: string; values: Record<string, string>`; defaults in `EMPTY_PLAN_FORM`: `annualPrice: "", highlighted: false, contactOnly: false, sortOrder: "0", values: {}`.
  - `planToForm`: `annualPrice: plan.annualPriceMinor === null ? "" : minorToInput(plan.annualPriceMinor, plan.currency)`, `highlighted`, `contactOnly`, `sortOrder: String(plan.sortOrder)`, `values: { ...plan.values }`.
  - Add `"annualPrice" | "sortOrder"` to `PlanFormProblems`.
  - Helpers:
    ```ts
    export type ValueMode = "yes" | "no" | "text";
    export const valueMode = (value: string): ValueMode =>
      value === "true" ? "yes" : value === "" || value === "false" ? "no" : "text";
    export const modeToValue = (mode: ValueMode, text: string): string =>
      mode === "yes" ? "true" : mode === "no" ? "false" : text;
    const sentValues = (values: Record<string, string>): Record<string, string> =>
      Object.fromEntries(
        Object.entries(values)
          .filter(([, v]) => v.trim() !== "" && v !== "false")
          .map(([k, v]) => [k, v.trim()]),
      );
    ```
  - `checkPlanForm`: skip the price problems when `form.contactOnly` (use `priceMinor = 0`); parse `annualPrice` with `parseMoneyToMinor` when non-blank (problem `Enter an amount such as 25000.`; also cap at `MAX_PLAN_PRICE_MINOR`); parse `sortOrder` with `parseWholeNumber(form.sortOrder, { min: 0, max: 1000 })` (problem `Enter a whole number from 0 to 1000.`). Build the body with `annualPriceMinor` (omit when blank), `highlighted`, `contactOnly`, `sortOrder`, `values: sentValues(form.values)`.
  - `toUpdatePlanInput`: add comparisons for `highlighted`, `contactOnly`, `sortOrder`; `if ((input.annualPriceMinor ?? null) !== plan.annualPriceMinor) body.annualPriceMinor = input.annualPriceMinor ?? null;`; and `if (JSON.stringify(sortEntries(input.values ?? {})) !== JSON.stringify(sortEntries(sentValues(plan.values)))) body.values = input.values ?? {};` with `sortEntries = (o) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b))`.

- [ ] **Step 4: Run, expect PASS.** Then fix `plans-screen.test.ts`'s `definition()` fixture by adding the new response fields (`annualPriceMinor: null, highlighted: false, contactOnly: false, sortOrder: 0, values: {}`).

- [ ] **Step 5: UI.** In `plans-screen.tsx`:
  - `PlansBody`: add `const [tab, setTab] = useState<"plans" | "features">("plans");` and render two `Button`s (`variant={tab === "plans" ? "primary" : "ghost"}`) under the header: "Plans" / "Features". When `tab === "features"` render `<PlanFeaturesPanel />` (from the new file) instead of the plans table and hide "Add plan".
  - Update the info note: replace "Each activation adds ..." sentence stays; append "What you enter here is what the public pricing page shows."
  - `PlansTable`: add "Annual" column (`plan.contactOnly ? "Custom" : plan.annualPriceMinor === null ? "-" : formatMoney(plan.annualPriceMinor, plan.currency)`), show the price cell as `plan.contactOnly ? "Custom" : formatMoney(...)`, add a `Pill` "Most popular" next to the name when `plan.highlighted`.
  - `PlanDialog`: add `NumberField` "Annual price (optional)" (hint: "Price for 365 days. The website shows monthly x 12 struck out next to it."), `NumberField` "Display order", `CheckField` "Most popular" (`highlighted`), `CheckField` "Contact us (custom pricing)" with hint "Hides the price; the card shows Custom pricing and a Contact us button." (`contactOnly`). Disable the Price field label hint when `contactOnly`. Load features with `useResource(() => getApi().plan.listFeatures(), [])` and render a "Compare table values" section: for each feature, a row with its section + label, a `<select>` (Included / Not included / Custom value) bound to `valueMode(form.values[f.id] ?? "")` and, when mode is `text`, a `TextField` for the text; wire changes through `setForm((c) => ({ ...c, values: { ...c.values, [f.id]: modeToValue(mode, text) } }))`. If there are zero features show "Add feature rows on the Features tab first."
  - `plan-features-panel.tsx`: `useResource(() => getApi().plan.listFeatures(), [])`, a `DataTable` (Section, Label, Order, On card, Card text, Actions[Edit, Delete]), "Add feature" button, a `FeatureDialog` (`TextField` section, `TextField` label, `NumberField` order, `CheckField` "Show on pricing cards", `TextField` card text with hint "Use {value} where the plan's value goes, e.g. {value} printers. Leave blank to show the label.") using `FormDialog` + `useActionRunner` exactly as `PlanDialog` does, and a confirm dialog for delete ("This removes the row and every plan's value for it.").

- [ ] **Step 6: Verify.** From `apps/shop-web`: `npx tsc --noEmit`, `npx eslint src/lib/plan-form.ts src/components/admin`, `timeout 300 npx jest src/lib/plan-form.test.ts src/components/admin/plans-screen.test.ts`. Expected: all green.

- [ ] **Step 7: Commit** (the files above), message `plans: admin editor for annual price, badge, contact-only and Compare-table values`.

---

### Task 9: Marketing site rendering

**Files:**

- Modify: `apps/marketing-web/src/lib/plans.ts`, `apps/marketing-web/src/lib/plans.test.ts`, `apps/marketing-web/src/components/sections/Pricing.tsx`, `apps/marketing-web/src/components/sections/index.ts` (only if it re-exports anything removed)
- Create: `apps/marketing-web/src/components/sections/PricingPlans.tsx` (client: toggle + cards), `apps/marketing-web/src/components/sections/CompareTable.tsx` (server)
- Delete: `apps/marketing-web/src/content/pricing.ts`, `apps/marketing-web/src/lib/pricing.ts`, `apps/marketing-web/src/lib/pricing.test.ts`

**Interfaces:**

- Consumes: `PublicPlansResponse` shape (Task 2). marketing-web does not depend on `@print-automated/types` today; **check** `apps/marketing-web/package.json` and, if absent, redeclare the types locally in `plans.ts` (as it does now for `PublicPlan`) rather than adding a dependency.
- Produces: `fetchPlans(apiBaseUrl): Promise<PlansPayload | null>` where `PlansPayload = { plans: PublicPlan[]; features: PublicFeature[] }`; pure helpers `monthlyYearTotal(plan)`, `annualSaving(plan)`, `cardBullets(plan, features)`, `groupFeatures(features)`, `cellKind(value)`.

- [ ] **Step 1: Write failing tests** (extend `plans.test.ts`; update its existing `fetchPlans` tests for the new `{ items, features }` body and `{ plans, features }` result):

```ts
const plan = (over: Partial<PublicPlan> = {}): PublicPlan => ({
  name: "Starter",
  description: null,
  priceMinor: 600_000,
  currency: "PKR",
  billingPeriodDays: 30,
  annualPriceMinor: 6_000_000,
  highlighted: false,
  contactOnly: false,
  ...over,
});
const feature = (over: Partial<PublicFeature> = {}): PublicFeature => ({
  section: "Capacity",
  label: "Printers",
  showOnCard: true,
  cardText: null,
  values: {},
  ...over,
});

describe("annual pricing", () => {
  it("struck-out total is monthly x 12 and the saving is the difference", () => {
    expect(monthlyYearTotal(plan())).toBe(7_200_000);
    expect(annualSaving(plan())).toBe(1_200_000);
  });
  it("no saving when there is no annual price, or it is not cheaper", () => {
    expect(annualSaving(plan({ annualPriceMinor: null }))).toBe(0);
    expect(annualSaving(plan({ annualPriceMinor: 7_200_000 }))).toBe(0);
    expect(annualSaving(plan({ annualPriceMinor: 9_000_000 }))).toBe(0);
  });
});

describe("cardBullets", () => {
  const features = [
    feature({ label: "Printers", cardText: "{value} printers", values: { Starter: "2" } }),
    feature({ label: "Routing", cardText: null, values: { Starter: "true" } }),
    feature({ label: "Reports", cardText: "Essential daily reports", values: { Starter: "true" } }),
    feature({ label: "Audit log", showOnCard: false, values: { Starter: "true" } }),
    feature({ label: "Rules", values: { Starter: "false" } }),
    feature({ label: "Exports", values: {} }),
    feature({ label: "Support", cardText: null, values: { Starter: "Email" } }),
  ];
  it("renders templates, ticks and text; skips dashes, missing values and hidden rows", () => {
    expect(cardBullets(plan(), features)).toEqual([
      "2 printers",
      "Routing",
      "Essential daily reports",
      "Support: Email",
    ]);
  });
  it("a plan with no values has no bullets", () => {
    expect(cardBullets(plan({ name: "Nobody" }), features)).toEqual([]);
  });
});

describe("groupFeatures / cellKind", () => {
  it("groups by section in first-appearance order", () => {
    const rows = [
      feature({ section: "A", label: "1" }),
      feature({ section: "B", label: "2" }),
      feature({ section: "A", label: "3" }),
    ];
    expect(groupFeatures(rows).map((g) => [g.section, g.rows.map((r) => r.label)])).toEqual([
      ["A", ["1", "3"]],
      ["B", ["2"]],
    ]);
  });
  it("cellKind", () => {
    expect(cellKind("true")).toEqual({ kind: "yes" });
    expect(cellKind("false")).toEqual({ kind: "no" });
    expect(cellKind(undefined)).toEqual({ kind: "no" });
    expect(cellKind("Unlimited")).toEqual({ kind: "text", text: "Unlimited" });
  });
});

describe("price display", () => {
  it("never prints PKR 0 for a contact-only plan, but a paid plan at 0 still prints it", () => {
    expect(priceLabel(plan({ contactOnly: true, priceMinor: 0 }), "monthly")).toBe(
      "Custom pricing",
    );
    expect(priceLabel(plan({ priceMinor: 0 }), "monthly")).toBe("PKR 0");
  });
  it("annual view falls back to monthly when there is no annual price", () => {
    expect(priceLabel(plan(), "annual")).toBe("PKR 60,000");
    expect(priceLabel(plan({ annualPriceMinor: null }), "annual")).toBe("PKR 6,000");
  });
});
```

(`priceLabel(plan, cycle)` returns the main price string. Import the new names.)

- [ ] **Step 2: Run, expect FAIL.** From `apps/marketing-web`: `timeout 300 npx jest src/lib/plans.test.ts`.

- [ ] **Step 3: Implement `lib/plans.ts`.** Extend `PublicPlan` with `annualPriceMinor: number | null; highlighted: boolean; contactOnly: boolean`; add:

```ts
export type PublicFeature = {
  section: string;
  label: string;
  showOnCard: boolean;
  cardText: string | null;
  /** Keyed by plan name; a missing key renders as a dash. */
  values: Record<string, string>;
};

export type PlansPayload = { plans: PublicPlan[]; features: PublicFeature[] };
export type BillingCycle = "monthly" | "annual";

export const monthlyYearTotal = (plan: PublicPlan): number => plan.priceMinor * 12;

export function annualSaving(plan: PublicPlan): number {
  if (plan.annualPriceMinor === null) return 0;
  return Math.max(0, monthlyYearTotal(plan) - plan.annualPriceMinor);
}

export function priceLabel(plan: PublicPlan, cycle: BillingCycle): string {
  if (plan.contactOnly) return "Custom pricing";
  const minor =
    cycle === "annual" && plan.annualPriceMinor !== null ? plan.annualPriceMinor : plan.priceMinor;
  return formatPlanPrice(minor, plan.currency);
}

export function cardBullets(plan: PublicPlan, features: readonly PublicFeature[]): string[] {
  const bullets: string[] = [];
  for (const feature of features) {
    const value = feature.values[plan.name];
    if (!feature.showOnCard || value === undefined || value === "false") continue;
    if (value === "true") bullets.push(feature.cardText ?? feature.label);
    else if (feature.cardText?.includes("{value}"))
      bullets.push(feature.cardText.replace("{value}", value));
    else bullets.push(`${feature.label}: ${value}`);
  }
  return bullets;
}

export function groupFeatures(
  features: readonly PublicFeature[],
): { section: string; rows: PublicFeature[] }[] {
  const groups: { section: string; rows: PublicFeature[] }[] = [];
  for (const feature of features) {
    const group = groups.find((g) => g.section === feature.section);
    if (group) group.rows.push(feature);
    else groups.push({ section: feature.section, rows: [feature] });
  }
  return groups;
}

export type Cell = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string };
export function cellKind(value: string | undefined): Cell {
  if (value === "true") return { kind: "yes" };
  if (value === undefined || value === "false" || value.trim() === "") return { kind: "no" };
  return { kind: "text", text: value };
}
```

Note the "Rules" test row has `cardText` default `null` and `showOnCard` true with value `"false"` -> skipped; "Exports" has no value -> skipped; matches the expected list.

Update `isPublicPlan` to require `annualPriceMinor` (number|null), `highlighted`/`contactOnly` booleans; add `isPublicFeature` (strings, boolean, `values` an object of strings); `fetchPlans` parses `{ items, features }`, returns `{ plans: items, features }` or `null`. Update the existing tests' mock bodies accordingly.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Components.**
  - `Pricing.tsx` (server): `const payload = await fetchPlans(apiBaseUrl);` keep the header and both fallback cards (`payload === null` -> unavailable; `payload.plans.length === 0` -> being finalised). Otherwise render `<PricingPlans plans={payload.plans} features={payload.features} contactHref={contactHref} />` followed, when `payload.features.length > 0`, by `<CompareTable plans={payload.plans} features={payload.features} />`. Remove the old imports.
  - `PricingPlans.tsx` (`"use client"`): state `cycle`; show the radiogroup toggle (copy the existing toggle markup from `git show HEAD~3:apps/marketing-web/src/components/sections/Pricing.tsx`, or `d495f01^`) only when `plans.some((p) => !p.contactOnly && p.annualPriceMinor !== null)`; label "Annual" with **no** "2 months free". Card per plan: `Card` with `plan.highlighted && "border-brand-500 shadow-lg ring-1 ring-brand-500 lg:-my-3"`, `Badge variant="brand"` "Most popular" when highlighted, name, description; for `contactOnly`: `<p>` "Custom pricing" and a `Button` "Contact us" (variant secondary); otherwise price via `priceLabel`, unit `/ {cycle === "annual" && plan.annualPriceMinor !== null ? "year" : periodUnit(plan.billingPeriodDays)}`, and on the annual view with a saving > 0: `<s>{formatPlanPrice(monthlyYearTotal(plan), plan.currency)}</s>` struck-out before the price plus `Save {formatPlanPrice(annualSaving(plan), plan.currency)} a year.`; else `billedNote`. Bullets from `cardBullets` as a check-list (lucide `Check`), none for `contactOnly`. CTA `Talk to us` (primary when highlighted, else secondary); use grid `sm:grid-cols-2 lg:grid-cols-{n}` where n = `Math.min(plans.length, 4)` (map to literal class names: `lg:grid-cols-2|3|4`).
  - `CompareTable.tsx` (server): `<h3>` "Compare plans"; a responsive scroll wrapper; a `<table>` with header `Feature` + one `<th scope="col">` per plan (highlighted column gets a tinted background); body: for each `groupFeatures(features)` group, a section row (`<th colSpan>`) then one row per feature with a `<th scope="row">` label and per-plan cell via `cellKind(feature.values[plan.name])` rendering lucide `Check` (+ `sr-only` "Included"), `Minus` (+ "Not included"), or the text. Reuse the previous table's classes from the old `Pricing.tsx` in git history (`git show d495f01^:apps/marketing-web/src/components/sections/Pricing.tsx`).
  - Delete `content/pricing.ts`, `lib/pricing.ts`, `lib/pricing.test.ts` after `grep -rn "content/pricing\|lib/pricing" apps/marketing-web/src` shows no remaining importers (`siteConfig.contactEmail` stays in `content/site.ts`).

- [ ] **Step 6: Verify.** From `apps/marketing-web`: `npx tsc --noEmit`, `npx eslint src`, `timeout 300 npx jest`, `npx next build` (needs the API for revalidation only at runtime; the build must succeed with the API down and render the "unavailable" card).

- [ ] **Step 7: Commit** (new/modified files; `git rm` the three deleted ones in the same commit), message `marketing: render pricing cards, annual toggle and Compare table from the API`.

---

### Task 10: End-to-end verification (no new code)

**Files:** none (fix defects in the owning task's files if found).

- [ ] **Step 1: Start only what you need and record PIDs.** API (`services/api`), shop-web, marketing-web on their dev ports (3000, 3002, 3003). Note each PID you spawn; kill only those at the end. Reuse the already-running dev servers if present and healthy.

- [ ] **Step 2: Seed.** `pnpm --filter @print-automated/api prisma:seed-plans`. Then `curl http://localhost:3000/v1/plans`. Expected: 4 items ordered Starter, Growth, Business, Enterprise; `features` has 11 rows with `values` keyed by plan name; no `id`/`archived`.

- [ ] **Step 3: Marketing page.** Open `http://localhost:3003/#pricing`. Expected: PKR prices (6,000 / 11,000 / 15,000), Growth badge, Enterprise "Custom pricing" + "Contact us"; Annual toggle shows struck-out 72,000 -> 60,000 and "Save PKR 12,000 a year" (Starter), 132,000 -> 110,000 (Growth), 180,000 -> 150,000 (Business); no "2 months free"; Compare plans table matches the old one with a fourth "Enterprise" column of "Custom".

- [ ] **Step 4: Admin round-trip.** Sign in as the platform admin at `http://localhost:3002/admin/plans`. Change Starter's monthly price to 6,500 and the Printers value to 3; add a feature row on the Features tab and tick it for Growth. Within ~60 s (or after the revalidate), reload the marketing page and confirm all three changes appear. Inspect the DB (`SELECT name, price_minor, annual_price_minor, highlighted, contact_only FROM plan_definitions ORDER BY sort_order;` and the `plan_feature_values` rows) and confirm they match. Revert the test edits afterwards.

- [ ] **Step 5: Regression.** Run the whole `plan-definitions.e2e-spec.ts` and `timeout 300 npx jest` in `apps/shop-web`, `apps/marketing-web`, `packages/validation`; `npx tsc --noEmit` in `services/api`, `packages/api-client`, `packages/types`. Expected: green. Confirm activating a business on a plan still extends by 30 days (existing e2e covers it).

- [ ] **Step 6: Report** with the evidence (commands + outputs, screenshots of the page) before claiming done; update the memory index if anything non-obvious was learned.

---

## Self-review

- **Spec coverage:** data model (Task 1), API admin + public (Tasks 3-5), seed (6), api-client (7), admin UI incl. Features tab, Most popular, contact-only, annual price, display order (8), marketing cards/toggle/table/removal of hard-coded content and "2 months free" (9), manual walkthrough + DB inspection (10). Out-of-scope items (annual activation, gateway, multi-currency) have no tasks, by design.
- **Placeholders:** the only prose-described (not fully coded) steps are the JSX layouts in Tasks 8-9; each names the exact existing markup/classes to copy and the exact behaviours tests pin through pure helpers.
- **Type consistency:** `values` is `Record<featureId, string>` on admin responses and the form, `Record<planName, string>` on the public wire; `PublicPlan`/`PublicPlanFeature` in `@print-automated/types` mirror marketing's local `PublicPlan`/`PublicFeature`; helper names (`valueMode`, `modeToValue`, `cardBullets`, `groupFeatures`, `cellKind`, `priceLabel`, `annualSaving`, `monthlyYearTotal`) are used identically across tests and implementations.
- **Review Focus:** each line maps to a test: empty values (Task 9 `cardBullets`, Task 10), unknown feature id (Task 3), contact-only price (Task 9 `priceLabel`), annual not cheaper (Task 9 `annualSaving`), duplicate section+label (Task 4), cascades (Tasks 3-4), API down / zero plans (Task 9 build check), rename safety (values keyed by id in DB; Task 3 update test replaces by id).
