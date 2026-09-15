import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ShopStatus, type PricingRule as PricingRuleRow } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { computeQuote, type PricingRule } from "@print-automated/pricing";
import {
  ColorMode,
  Orientation,
  PaperSize,
  Sides,
  type PrintConfiguration,
} from "@print-automated/types";
import { AppModule } from "../src/app.module.js";

/** §4.2's own Done-when, proven against real Postgres rows -- not the
 * seed script directly (that would couple this test to `db:seed`
 * having been run first, which no other integration test in this
 * project assumes), but the same shape 3.2's pricing_rules migration
 * and seed.ts actually produce. */
describe("Pricing rules (4.2, e2e)", () => {
  let prisma: PrismaService;
  let shopAId: string;
  let shopBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const shopA = await prisma.shop.create({
      data: {
        name: `Pricing E2E Shop A ${randomUUID()}`,
        address: "1 Test Street, Lahore",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    const shopB = await prisma.shop.create({
      data: {
        name: `Pricing E2E Shop B ${randomUUID()}`,
        address: "2 Test Street, Lahore",
        status: ShopStatus.OPEN,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    shopAId = shopA.id;
    shopBId = shopB.id;

    await prisma.pricingRule.create({
      data: {
        shopId: shopAId,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 5000,
      },
    });
    await prisma.pricingRule.create({
      data: {
        shopId: shopBId,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 600,
        colorSurchargePerPageMinor: 0,
        otherCharges: [],
        minimumChargeMinor: 2000,
      },
    });
  });

  afterAll(async () => {
    await prisma.pricingRule.deleteMany({ where: { shopId: { in: [shopAId, shopBId] } } });
    await prisma.shop.deleteMany({ where: { id: { in: [shopAId, shopBId] } } });
  });

  it("two shops quote different totals for an identical configuration", async () => {
    const config: PrintConfiguration = {
      pages: { mode: "all" },
      copies: 2,
      paperSize: PaperSize.A4,
      color: ColorMode.BW,
      sides: Sides.SINGLE,
      orientation: Orientation.PORTRAIT,
    };
    const documentPageCount = 10;
    const platformFeeMinor = 0;

    const [ruleA, ruleB] = await Promise.all([
      currentPricingRule(prisma, shopAId),
      currentPricingRule(prisma, shopBId),
    ]);

    const quoteA = computeQuote(config, documentPageCount, toQuoteInput(ruleA), platformFeeMinor);
    const quoteB = computeQuote(config, documentPageCount, toQuoteInput(ruleB), platformFeeMinor);

    expect(quoteA.totalMinor).not.toBe(quoteB.totalMinor);
    // Concretely: 10 pages x 2 copies x Rs 10.00/page = Rs 200.00 for A;
    // 10 x 2 x Rs 6.00/page = Rs 120.00 for B -- both well above their
    // respective minimums, so neither total is the minimum-charge floor
    // masking the real per-page difference.
    expect(quoteA.totalMinor).toBe(20000);
    expect(quoteB.totalMinor).toBe(12000);
  });

  it("a repriced shop gets a new version row, not a mutated one -- the old row still reads back unchanged", async () => {
    const v1 = await currentPricingRule(prisma, shopAId);

    await prisma.pricingRule.create({
      data: {
        shopId: shopAId,
        version: 2,
        currency: "PKR",
        pricePerPageMinor: 1200,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 5000,
      },
    });

    const v1Reread = await prisma.pricingRule.findUniqueOrThrow({
      where: { shopId_version: { shopId: shopAId, version: 1 } },
    });
    expect(v1Reread.pricePerPageMinor).toBe(v1.pricePerPageMinor);

    const current = await currentPricingRule(prisma, shopAId);
    expect(current.version).toBe(2);
    expect(current.pricePerPageMinor).toBe(1200);

    await prisma.pricingRule.delete({ where: { id: current.id } });
  });
});

async function currentPricingRule(prisma: PrismaService, shopId: string): Promise<PricingRuleRow> {
  return prisma.pricingRule.findFirstOrThrow({
    where: { shopId },
    orderBy: { version: "desc" },
  });
}

function toQuoteInput(row: PricingRuleRow): PricingRule {
  return {
    currency: row.currency,
    pricePerPageMinor: row.pricePerPageMinor,
    colorSurchargePerPageMinor: row.colorSurchargePerPageMinor,
    otherCharges: row.otherCharges as unknown as PricingRule["otherCharges"],
    minimumChargeMinor: row.minimumChargeMinor,
  };
}
