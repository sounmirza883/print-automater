import { PrismaClient } from "@prisma/client";
import { FEATURE_CATALOG, PLAN_CATALOG } from "../src/shop-plan/plan-catalog.js";

const prisma = new PrismaClient();
const log = (message: string): void => {
  process.stdout.write(`${message}
`);
};

/** Idempotent and non-destructive: creates only the features and plans that are missing and
 * never overwrites one that exists (an admin may have edited it). The plan migration
 * deliberately creates none, because production plans are a business decision; run this
 * once on request: `pnpm --filter @print-automated/api prisma:seed-plans`. */
async function main(): Promise<void> {
  const featureIds = new Map<string, string>();
  for (const [index, feature] of FEATURE_CATALOG.entries()) {
    const existing = await prisma.planFeature.findUnique({
      where: { section_label: { section: feature.section, label: feature.label } },
    });
    const row =
      existing ??
      (await prisma.planFeature.create({
        data: {
          section: feature.section,
          label: feature.label,
          sortOrder: index * 10,
          showOnCard: feature.showOnCard,
          cardText: feature.cardText ?? null,
        },
      }));
    featureIds.set(feature.key, row.id);
    log(`${existing ? "kept   " : "created"} feature ${feature.section} / ${feature.label}`);
  }

  for (const [index, plan] of PLAN_CATALOG.entries()) {
    if (await prisma.planDefinition.findUnique({ where: { name: plan.name } })) {
      log(`kept    plan ${plan.name}`);
      continue;
    }
    await prisma.planDefinition.create({
      data: {
        name: plan.name,
        description: plan.description,
        priceMinor: plan.priceMinor,
        annualPriceMinor: plan.annualPriceMinor,
        currency: plan.currency,
        billingPeriodDays: plan.billingPeriodDays,
        highlighted: plan.highlighted,
        contactOnly: plan.contactOnly,
        sortOrder: (index + 1) * 10,
        featureValues: {
          create: Object.entries(plan.values).map(([key, value]) => ({
            featureId: featureIds.get(key)!,
            value,
          })),
        },
      },
    });
    log(`created plan ${plan.name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
