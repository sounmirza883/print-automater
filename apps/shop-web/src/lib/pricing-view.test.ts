import type { PricingRule } from "@print-automated/api-client";
import {
  buildPricingInput,
  buildProductInput,
  emptyPricingForm,
  emptyProductForm,
  newCharge,
  ruleToForm,
} from "./pricing-view";

const rule: PricingRule = {
  id: "r",
  shopId: "s",
  version: 2,
  currency: "PKR",
  pricePerPageMinor: 1200,
  colorSurchargePerPageMinor: 800,
  otherCharges: [{ label: "Rush", amountMinor: 5000 }],
  minimumChargeMinor: 2000,
  paperSizeSurchargePerPageMinor: { A3: 1000 },
  paperTypeSurchargePerPageMinor: null,
  finishingChargeMinor: { BINDING: 15000 },
  taxRateBasisPoints: 1750,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("pricing form <-> API body", () => {
  it("round-trips a rule exactly, in integer minor units", () => {
    const built = buildPricingInput(ruleToForm(rule));
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input).toEqual({
        currency: "PKR",
        pricePerPageMinor: 1200,
        colorSurchargePerPageMinor: 800,
        minimumChargeMinor: 2000,
        otherCharges: [{ label: "Rush", amountMinor: 5000 }],
        paperSizeSurchargePerPageMinor: { A3: 1000 },
        paperTypeSurchargePerPageMinor: undefined,
        finishingChargeMinor: { BINDING: 15000 },
        taxRateBasisPoints: 1750,
      });
    }
  });

  it("omits blank surcharges and treats a leading minus on an extra charge as a discount", () => {
    const form = {
      ...emptyPricingForm(),
      pricePerPage: "10",
      sizeSurcharges: { A3: "", A5: "2.5" },
    };
    form.otherCharges = [{ ...newCharge(), label: "Loyalty", amount: "-1.50" }];
    const built = buildPricingInput(form);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input.paperSizeSurchargePerPageMinor).toEqual({ A5: 250 });
      expect(built.input.otherCharges).toEqual([{ label: "Loyalty", amountMinor: -150 }]);
      expect(built.input.taxRateBasisPoints).toBeUndefined();
    }
  });

  it("names every wrong field instead of sending a bad body", () => {
    const form = {
      ...emptyPricingForm("pk"),
      pricePerPage: "abc",
      taxPercent: "150",
      colorSurcharge: "1.999",
    };
    form.finishingCharges = { BINDING: "x" };
    const built = buildPricingInput(form);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(Object.keys(built.errors).sort()).toEqual([
        "colorSurcharge",
        "currency",
        "finishing.BINDING",
        "pricePerPage",
        "taxPercent",
      ]);
    }
  });
});

describe("buildProductInput", () => {
  it("requires a name and validates the tax rate", () => {
    const bad = buildProductInput({ ...emptyProductForm(), taxPercent: "abc" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["name", "taxPercent"]);
  });

  it("sends printer requirements only when something is ticked", () => {
    const none = buildProductInput({ ...emptyProductForm(), name: "Copies" });
    expect(none.ok && none.input.printerRequirements).toBeUndefined();
    const some = buildProductInput({
      ...emptyProductForm(),
      name: "Posters",
      needsColor: true,
      needsA3: true,
      paperSize: "A3",
    });
    expect(some.ok && some.input.printerRequirements).toEqual({
      color: true,
      duplex: false,
      a4: true,
      a3: true,
    });
    expect(some.ok && some.input.paperRequirements).toEqual({ paperSize: "A3" });
  });
});
