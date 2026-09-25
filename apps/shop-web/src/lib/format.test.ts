import {
  formatAge,
  formatBytes,
  formatMoney,
  humanizeEnum,
  minorToInput,
  parseMoneyToMinor,
  priorityLabel,
} from "./format";

describe("formatMoney", () => {
  it("scales integer minor units by the currency's own exponent", () => {
    // PKR is 2-decimal whatever the runtime's CLDR cash-digits say (Chromium reports 0).
    expect(formatMoney(12550, "PKR")).toBe("PKR 125.50");
    expect(formatMoney(0, "USD")).toBe("USD 0.00");
    expect(formatMoney(1500, "JPY")).toBe("JPY 1,500");
    expect(formatMoney(12345, "KWD")).toBe("KWD 12.345");
  });

  it("groups thousands and keeps negatives (a net that went below zero)", () => {
    expect(formatMoney(123456789, "PKR")).toBe("PKR 1,234,567.89");
    expect(formatMoney(-2500, "PKR")).toBe("PKR -25.00");
  });

  it("does not guess a scale for an unknown currency code", () => {
    expect(formatMoney(1234, "ZZZZ")).toBe("ZZZZ 1,234 (minor units)");
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("reads naturally", () => {
    expect(formatAge(null, now)).toBe("never");
    expect(formatAge("2026-09-25T11:59:40Z", now)).toBe("just now");
    expect(formatAge("2026-09-25T11:55:00Z", now)).toBe("5 min ago");
    expect(formatAge("2026-09-25T09:00:00Z", now)).toBe("3 h ago");
    expect(formatAge("2026-09-22T12:00:00Z", now)).toBe("3 d ago");
  });
});

describe("small helpers", () => {
  it("humanizes enums, bytes and priorities", () => {
    expect(humanizeEnum("PRINTER_OFFLINE")).toBe("Printer offline");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
    expect(priorityLabel(0)).toBe("Normal");
    expect(priorityLabel(10)).toBe("High");
    expect(priorityLabel(20)).toBe("Urgent");
    expect(priorityLabel(15)).toBe("High");
  });
});

describe("parseMoneyToMinor", () => {
  it("turns an amount typed in major units into integer minor units", () => {
    expect(parseMoneyToMinor("125.50", "PKR")).toBe(12550);
    expect(parseMoneyToMinor("125.5", "PKR")).toBe(12550);
    expect(parseMoneyToMinor("125", "PKR")).toBe(12500);
    expect(parseMoneyToMinor("1500", "JPY")).toBe(1500);
    expect(parseMoneyToMinor("0.29", "USD")).toBe(29);
  });

  it("rejects anything that is not a plain amount the currency can hold", () => {
    for (const bad of ["", "abc", "-5", "1.999", "1,000", "1e3", "12.5.1", "1500.5"]) {
      expect(parseMoneyToMinor(bad, bad === "1500.5" ? "JPY" : "PKR")).toBeNull();
    }
  });
});

describe("minorToInput", () => {
  it("is the inverse of parseMoneyToMinor", () => {
    expect(minorToInput(12550, "PKR")).toBe("125.50");
    expect(minorToInput(1500, "JPY")).toBe("1500");
    expect(parseMoneyToMinor(minorToInput(29, "USD"), "USD")).toBe(29);
  });
});
