import { maskEmail, maskName, maskPhone } from "./mask.js";

describe("audit masking helpers", () => {
  it("maskEmail keeps only the first character of the local part and the domain (23.15)", () => {
    expect(maskEmail("zainab@example.com")).toBe("z***@example.com");
  });

  it("maskName keeps only the first character (24.1)", () => {
    expect(maskName("Zainab Khan")).toBe("Z***");
    expect(maskName("  Ali ")).toBe("A***");
  });

  it("maskPhone keeps only the last two digits, never the rest (24.1)", () => {
    expect(maskPhone("+92 300 555 1234")).toBe("***34");
    expect(maskPhone("7")).toBe("***");
  });

  it("never returns the raw value", () => {
    for (const value of ["Zainab Khan", "+923005551234"]) {
      expect(maskName(value)).not.toContain(value);
      expect(maskPhone(value)).not.toContain(value);
    }
  });
});
