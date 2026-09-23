import {
  ColorMode,
  Finishing,
  Orientation,
  PaperSize,
  PaperType,
  Sides,
  type PrintConfiguration,
} from "@print-automated/types";
import { computeQuote } from "./compute-quote.js";
import { InvalidQuoteInputError } from "./types.js";
import type { PricingRule } from "./types.js";

const BASE_RULE: PricingRule = {
  currency: "PKR",
  pricePerPageMinor: 500,
  colorSurchargePerPageMinor: 300,
  otherCharges: [],
  minimumChargeMinor: 3000,
};

const PLATFORM_FEE = 2000;

function config(overrides: Partial<PrintConfiguration> = {}): PrintConfiguration {
  return {
    pages: { mode: "all" },
    copies: 1,
    paperSize: PaperSize.A4,
    color: ColorMode.BW,
    sides: Sides.SINGLE,
    orientation: Orientation.PORTRAIT,
    ...overrides,
  };
}

describe("computeQuote", () => {
  const pageCases = [1, 5, 20];
  const copyCases = [1, 3];
  const colorCases = [ColorMode.BW, ColorMode.COLOR];
  const sidesCases = [Sides.SINGLE, Sides.DOUBLE];

  const table = pageCases.flatMap((pages) =>
    copyCases.flatMap((copies) =>
      colorCases.flatMap((color) => sidesCases.map((sides) => ({ pages, copies, color, sides }))),
    ),
  );

  it.each(table)(
    "pages=$pages copies=$copies color=$color sides=$sides: matches the S19 formula and is duplex-invariant",
    ({ pages, copies, color, sides }) => {
      const quote = computeQuote(
        config({ pages: { mode: "all" }, copies, color, sides }),
        pages,
        BASE_RULE,
        PLATFORM_FEE,
      );

      const units = pages * copies;
      const expectedPagePrice = BASE_RULE.pricePerPageMinor * units;
      const expectedColorSurcharge =
        color === ColorMode.COLOR ? BASE_RULE.colorSurchargePerPageMinor * units : 0;
      const rawSubtotal = expectedPagePrice + expectedColorSurcharge;
      const expectedSubtotal = Math.max(rawSubtotal, BASE_RULE.minimumChargeMinor);

      expect(quote.subtotalMinor).toBe(expectedSubtotal);
      expect(quote.platformFeeMinor).toBe(PLATFORM_FEE);
      expect(quote.totalMinor).toBe(expectedSubtotal + PLATFORM_FEE);
      expect(quote.currency).toBe("PKR");

      // Every line item is itself an integer -- no floating-point money
      // anywhere in the output (S19/4.1's own requirement).
      for (const item of quote.lineItems) {
        expect(Number.isInteger(item.amountMinor)).toBe(true);
      }
      // Line items always fully account for the subtotal -- no hidden
      // math (S22's review screen shows exactly these line items).
      const lineItemSum = quote.lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
      expect(lineItemSum).toBe(quote.subtotalMinor);

      // Duplex (sides) has no effect on price -- re-run with the other
      // sides value and require byte-for-byte the same quote.
      const otherSides = sides === Sides.SINGLE ? Sides.DOUBLE : Sides.SINGLE;
      const quoteWithOtherSides = computeQuote(
        config({ pages: { mode: "all" }, copies, color, sides: otherSides }),
        pages,
        BASE_RULE,
        PLATFORM_FEE,
      );
      expect(quoteWithOtherSides).toEqual(quote);
    },
  );

  it("orientation has no effect on price either", () => {
    const portrait = computeQuote(
      config({ orientation: Orientation.PORTRAIT }),
      10,
      BASE_RULE,
      PLATFORM_FEE,
    );
    const landscape = computeQuote(
      config({ orientation: Orientation.LANDSCAPE }),
      10,
      BASE_RULE,
      PLATFORM_FEE,
    );
    expect(landscape).toEqual(portrait);
  });

  it("adds a visible minimum-order adjustment line item when the raw subtotal is below the floor", () => {
    // 1 page x 1 copy x Rs 5.00 = Rs 5.00 (500), well under the Rs 30.00 (3000) minimum.
    const quote = computeQuote(config({ pages: { mode: "all" } }), 1, BASE_RULE, PLATFORM_FEE);

    const adjustment = quote.lineItems.find((item) => item.label === "Minimum order adjustment");
    expect(adjustment).toBeDefined();
    expect(adjustment?.amountMinor).toBe(BASE_RULE.minimumChargeMinor - 500);
    expect(quote.subtotalMinor).toBe(BASE_RULE.minimumChargeMinor);
  });

  it("does not add a minimum-order adjustment when the raw subtotal already clears the floor", () => {
    // 20 pages x 1 copy x Rs 5.00 = Rs 100.00 (10000), well above the Rs 30.00 minimum.
    const quote = computeQuote(config({ pages: { mode: "all" } }), 20, BASE_RULE, PLATFORM_FEE);

    expect(quote.lineItems.some((item) => item.label === "Minimum order adjustment")).toBe(false);
    expect(quote.subtotalMinor).toBe(BASE_RULE.pricePerPageMinor * 20);
  });

  it("includes a shop's other charges as their own line items, contributing to the subtotal", () => {
    const ruleWithExtras: PricingRule = {
      ...BASE_RULE,
      otherCharges: [{ label: "Binding", amountMinor: 1500 }],
    };
    const quote = computeQuote(config(), 10, ruleWithExtras, PLATFORM_FEE);

    expect(quote.lineItems).toContainEqual({ label: "Binding", amountMinor: 1500 });
    expect(quote.subtotalMinor).toBe(BASE_RULE.pricePerPageMinor * 10 + 1500);
  });

  it("resolves an explicit page range instead of the full document", () => {
    const quote = computeQuote(
      config({ pages: { mode: "range", from: 3, to: 7 } }),
      // The document has 100 pages; only pages 3-7 (5 pages) are billed.
      100,
      BASE_RULE,
      PLATFORM_FEE,
    );
    expect(quote.subtotalMinor).toBe(
      Math.max(BASE_RULE.pricePerPageMinor * 5, BASE_RULE.minimumChargeMinor),
    );
  });

  it("never accepts a client-calculated total -- there is no total parameter to accept", () => {
    // Structural assertion: computeQuote's signature has no "total" or
    // "clientTotal" input at all, so there is nothing a caller could
    // even try to pass through as authoritative (S19's own requirement).
    expect(computeQuote.length).toBe(4);
  });

  it("rejects non-positive or non-integer copies", () => {
    expect(() => computeQuote(config({ copies: 0 }), 10, BASE_RULE, PLATFORM_FEE)).toThrow(
      InvalidQuoteInputError,
    );
    expect(() => computeQuote(config({ copies: -1 }), 10, BASE_RULE, PLATFORM_FEE)).toThrow(
      InvalidQuoteInputError,
    );
    expect(() => computeQuote(config({ copies: 1.5 }), 10, BASE_RULE, PLATFORM_FEE)).toThrow(
      InvalidQuoteInputError,
    );
  });

  it("rejects a negative platform fee", () => {
    expect(() => computeQuote(config(), 10, BASE_RULE, -1)).toThrow(InvalidQuoteInputError);
  });

  it("every quote carries a taxMinor field, defaulting to 0 when no rate is configured", () => {
    const quote = computeQuote(config(), 10, BASE_RULE, PLATFORM_FEE);
    expect(quote.taxMinor).toBe(0);
    expect(quote.totalMinor).toBe(quote.subtotalMinor + PLATFORM_FEE);
  });
});

describe("computeQuote -- 17.2 paper size surcharge", () => {
  const ruleWithA3Surcharge: PricingRule = {
    ...BASE_RULE,
    paperSizeSurchargePerPageMinor: { [PaperSize.A3]: 200 },
  };

  it("A3 costs more than A4 for an otherwise identical job", () => {
    const a4Quote = computeQuote(
      config({ paperSize: PaperSize.A4 }),
      10,
      ruleWithA3Surcharge,
      PLATFORM_FEE,
    );
    const a3Quote = computeQuote(
      config({ paperSize: PaperSize.A3 }),
      10,
      ruleWithA3Surcharge,
      PLATFORM_FEE,
    );
    expect(a3Quote.totalMinor).toBeGreaterThan(a4Quote.totalMinor);
    expect(a3Quote.lineItems).toContainEqual({
      label: "Paper size surcharge (A3)",
      amountMinor: 200 * 10, // units = pages(10) x copies(1)
    });
  });

  it("a size with no configured surcharge changes nothing", () => {
    const withRule = computeQuote(
      config({ paperSize: PaperSize.A4 }),
      10,
      ruleWithA3Surcharge,
      PLATFORM_FEE,
    );
    const withoutRule = computeQuote(
      config({ paperSize: PaperSize.A4 }),
      10,
      BASE_RULE,
      PLATFORM_FEE,
    );
    expect(withRule).toEqual(withoutRule);
  });
});

describe("computeQuote -- 17.2 paper type surcharge", () => {
  const ruleWithPhotoSurcharge: PricingRule = {
    ...BASE_RULE,
    paperTypeSurchargePerPageMinor: { [PaperType.PHOTO]: 150 },
  };

  it("PHOTO paper costs more than the STANDARD default for an otherwise identical job", () => {
    const standard = computeQuote(config(), 10, ruleWithPhotoSurcharge, PLATFORM_FEE);
    const photo = computeQuote(
      config({ paperType: PaperType.PHOTO }),
      10,
      ruleWithPhotoSurcharge,
      PLATFORM_FEE,
    );
    expect(photo.totalMinor).toBeGreaterThan(standard.totalMinor);
    expect(photo.lineItems).toContainEqual({
      label: "Paper type surcharge (PHOTO)",
      amountMinor: 150 * 10,
    });
  });

  it("an absent paperType (today's implicit 'standard') adds no surcharge even when one is configured for PHOTO", () => {
    const quote = computeQuote(config(), 10, ruleWithPhotoSurcharge, PLATFORM_FEE);
    expect(quote.lineItems.some((item) => item.label.startsWith("Paper type surcharge"))).toBe(
      false,
    );
  });
});

describe("computeQuote -- 17.2 finishing charges", () => {
  const ruleWithFinishing: PricingRule = {
    ...BASE_RULE,
    finishingChargeMinor: { [Finishing.BINDING]: 5000, [Finishing.LAMINATION]: 3000 },
  };

  it("each selected finishing option adds its own FLAT line item, not multiplied by copies", () => {
    const quote = computeQuote(
      config({ copies: 5, finishing: [Finishing.BINDING] }),
      10,
      ruleWithFinishing,
      PLATFORM_FEE,
    );
    expect(quote.lineItems).toContainEqual({ label: "Finishing: BINDING", amountMinor: 5000 });
    // Not 5000 * 5 copies -- finishing is per job, not per unit.
    expect(quote.lineItems.filter((item) => item.label === "Finishing: BINDING")).toHaveLength(1);
  });

  it("multiple finishing options each contribute their own line item", () => {
    const quote = computeQuote(
      config({ finishing: [Finishing.BINDING, Finishing.LAMINATION] }),
      10,
      ruleWithFinishing,
      PLATFORM_FEE,
    );
    expect(quote.lineItems).toContainEqual({ label: "Finishing: BINDING", amountMinor: 5000 });
    expect(quote.lineItems).toContainEqual({ label: "Finishing: LAMINATION", amountMinor: 3000 });
  });

  it("Finishing.NONE never itself carries a charge, even if a caller lists it", () => {
    const ruleWithNoneCharge: PricingRule = {
      ...BASE_RULE,
      finishingChargeMinor: { [Finishing.NONE]: 999 },
    };
    const quote = computeQuote(
      config({ finishing: [Finishing.NONE] }),
      10,
      ruleWithNoneCharge,
      PLATFORM_FEE,
    );
    expect(quote.lineItems.some((item) => item.label.startsWith("Finishing:"))).toBe(false);
  });

  it("an empty/absent finishing selection adds nothing, even when charges are configured", () => {
    const withEmpty = computeQuote(config({ finishing: [] }), 10, ruleWithFinishing, PLATFORM_FEE);
    const withUndefined = computeQuote(config(), 10, ruleWithFinishing, PLATFORM_FEE);
    expect(withEmpty).toEqual(withUndefined);
    expect(withEmpty.lineItems.some((item) => item.label.startsWith("Finishing:"))).toBe(false);
  });
});

describe("computeQuote -- 17.2 tax", () => {
  const ruleWithTax: PricingRule = { ...BASE_RULE, taxRateBasisPoints: 1700 }; // 17%

  it("adds a taxMinor computed from the post-minimum-charge subtotal, on top of the platform fee", () => {
    // 20 pages x 1 copy x Rs 5.00 = Rs 100.00 (10000), above the Rs 30.00 minimum.
    const quote = computeQuote(config(), 20, ruleWithTax, PLATFORM_FEE);
    const expectedSubtotal = BASE_RULE.pricePerPageMinor * 20;
    const expectedTax = Math.round((expectedSubtotal * 1700) / 10_000);

    expect(quote.subtotalMinor).toBe(expectedSubtotal);
    expect(quote.taxMinor).toBe(expectedTax);
    expect(quote.taxMinor).toBeGreaterThan(0);
    expect(quote.totalMinor).toBe(expectedSubtotal + expectedTax + PLATFORM_FEE);
    // Tax is never one of the visible line items -- lineItems still
    // sums to exactly subtotalMinor, the pre-existing invariant.
    const lineItemSum = quote.lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
    expect(lineItemSum).toBe(quote.subtotalMinor);
  });

  it("taxes the minimum-charge-adjusted subtotal, not the smaller raw one", () => {
    // 1 page x 1 copy = Rs 5.00 (500), well under the Rs 30.00 (3000) minimum.
    const quote = computeQuote(config(), 1, ruleWithTax, PLATFORM_FEE);
    expect(quote.subtotalMinor).toBe(BASE_RULE.minimumChargeMinor);
    expect(quote.taxMinor).toBe(Math.round((BASE_RULE.minimumChargeMinor * 1700) / 10_000));
  });
});

describe("computeQuote -- 17.2 discounts via existing otherCharges mechanism", () => {
  it("a negative-amount otherCharges line item reduces the subtotal, no new field needed", () => {
    const ruleWithDiscount: PricingRule = {
      ...BASE_RULE,
      otherCharges: [{ label: "Loyalty discount", amountMinor: -500 }],
    };
    // 20 pages x 1 copy x Rs 5.00 = Rs 100.00 (10000), well above the minimum.
    const quote = computeQuote(config(), 20, ruleWithDiscount, PLATFORM_FEE);
    expect(quote.lineItems).toContainEqual({ label: "Loyalty discount", amountMinor: -500 });
    expect(quote.subtotalMinor).toBe(BASE_RULE.pricePerPageMinor * 20 - 500);
  });
});
