import type { BillingPlanOption, PaymentProofResponse } from "@print-automated/types";
import {
  MAX_GRANT_MONTHS,
  PROOF_MAX_BYTES,
  durationLabel,
  fileToBase64,
  hasPendingProof,
  parseCustomDuration,
  previewKind,
  proofStatusLabel,
  proofStatusTone,
  validateProofFile,
  validateSubmission,
} from "./billing-view";

const plan: BillingPlanOption = {
  id: "plan-1",
  name: "Starter",
  priceMinor: 600_000,
  currency: "PKR",
  billingPeriodDays: 30,
  annualPriceMinor: 6_000_000,
};

const goodFile = { type: "image/png", size: 1_000 };

describe("validateProofFile", () => {
  it("accepts JPEG, PNG and PDF within 5 MB", () => {
    expect(validateProofFile({ type: "image/jpeg", size: 10 })).toBeNull();
    expect(validateProofFile({ type: "image/png", size: PROOF_MAX_BYTES })).toBeNull();
    expect(validateProofFile({ type: "application/pdf", size: 10 })).toBeNull();
  });

  it("refuses a missing, wrong-type, empty or oversized file with a reason", () => {
    expect(validateProofFile(null)).toMatch(/choose/i);
    expect(validateProofFile({ type: "image/gif", size: 10 })).toMatch(/JPEG, PNG or PDF/);
    expect(validateProofFile({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(validateProofFile({ type: "image/png", size: PROOF_MAX_BYTES + 1 })).toMatch(/5 MB/);
  });
});

describe("fileToBase64", () => {
  it("encodes raw bytes without a data: prefix, including files over one chunk", async () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 251);
    const encoded = await fileToBase64(new Blob([bytes]));
    expect(encoded.startsWith("data:")).toBe(false);
    expect(Buffer.from(encoded, "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("validateSubmission", () => {
  const valid = {
    planDefinitionId: "plan-1",
    amountText: "6000",
    transactionRef: " TX-123 ",
    file: goodFile,
  };

  it("passes a complete form and returns the amount in minor units", () => {
    const result = validateSubmission(valid, [plan]);
    expect(result.errors).toEqual({});
    expect(result.amountMinor).toBe(600_000);
  });

  it("reports every missing field at once", () => {
    const result = validateSubmission(
      { planDefinitionId: "", amountText: "", transactionRef: "  ", file: null },
      [plan],
    );
    expect(Object.keys(result.errors).sort()).toEqual(["file", "plan", "transactionRef"]);
    expect(result.amountMinor).toBeNull();
  });

  it("refuses a zero or unparseable amount", () => {
    expect(validateSubmission({ ...valid, amountText: "0" }, [plan]).errors.amount).toBeDefined();
    expect(validateSubmission({ ...valid, amountText: "abc" }, [plan]).errors.amount).toBeDefined();
  });
});

describe("durations", () => {
  it("words a grant: months, whole years, singular", () => {
    expect(durationLabel(1)).toBe("1 month");
    expect(durationLabel(3)).toBe("3 months");
    expect(durationLabel(12)).toBe("1 year");
    expect(durationLabel(24)).toBe("2 years");
    expect(durationLabel(18)).toBe("18 months");
  });

  it("parses a custom duration in months or years into whole months", () => {
    expect(parseCustomDuration("7", "months")).toBe(7);
    expect(parseCustomDuration("2", "years")).toBe(24);
    expect(parseCustomDuration(" 10 ", "years")).toBe(MAX_GRANT_MONTHS);
  });

  it("refuses zero, fractions, text, negatives and anything over 10 years", () => {
    for (const bad of ["0", "1.5", "abc", "-3", "", "121"]) {
      expect(parseCustomDuration(bad, "months")).toBeNull();
    }
    expect(parseCustomDuration("11", "years")).toBeNull();
  });
});

describe("status helpers", () => {
  const proof = (status: PaymentProofResponse["status"]) => ({ status }) as PaymentProofResponse;

  it("labels and tones each status", () => {
    expect(proofStatusLabel("PENDING")).toBe("Waiting for review");
    expect(proofStatusTone("PENDING")).toBe("caution");
    expect(proofStatusTone("APPROVED")).toBe("good");
    expect(proofStatusTone("REJECTED")).toBe("danger");
  });

  it("detects a proof still waiting for review", () => {
    expect(hasPendingProof([proof("APPROVED"), proof("PENDING")])).toBe(true);
    expect(hasPendingProof([proof("APPROVED"), proof("REJECTED")])).toBe(false);
  });

  it("previews PDFs in a frame and everything else as an image", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/png")).toBe("image");
  });
});
