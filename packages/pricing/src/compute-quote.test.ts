import {
  ColorMode,
  Orientation,
  PaperSize,
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
});
