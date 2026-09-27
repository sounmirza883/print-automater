import { sanitizeShopNameForEmail } from "./notification.service.js";

describe("sanitizeShopNameForEmail (23.18)", () => {
  it("strips control characters, newlines, URLs and markup, and caps the length", () => {
    const out = sanitizeShopNameForEmail(
      "Evil\r\nBcc: x@y.z <b>Shop</b> https://phish.example/login www.phish.example `x`",
    );
    for (const code of [0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069]) {
      expect(out).not.toContain(String.fromCharCode(code));
    }
    expect(out).not.toContain("http");
    expect(out).not.toContain("www.");
    expect(sanitizeShopNameForEmail("a".repeat(500)).length).toBeLessThanOrEqual(60);
  });

  it("removes C1 controls, Unicode line separators and bidi overrides", () => {
    const hostile = [
      "Shop",
      String.fromCharCode(0x85),
      "A",
      String.fromCharCode(0x2028),
      "B",
      String.fromCharCode(0x2029),
      "C",
      String.fromCharCode(0x202e),
      "gnp.exe",
      String.fromCharCode(0x2066),
      "D",
      String.fromCharCode(0x2069),
    ].join("");
    const out = sanitizeShopNameForEmail(hostile);
    for (const code of [0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069]) {
      expect(out).not.toContain(String.fromCharCode(code));
    }
    expect(out).toBe("Shop A B C gnp.exe D");
  });

  it("keeps an ordinary name intact and falls back when nothing is left", () => {
    expect(sanitizeShopNameForEmail("Ali's Print Shop")).toBe("Ali's Print Shop");
    expect(sanitizeShopNameForEmail("https://only.example")).toBe("a business");
  });
});
