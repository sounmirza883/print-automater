import { canonicalAddress } from "./email-address.js";

describe("canonicalAddress (23.18)", () => {
  it("trims, lowercases and strips plus-tags", () => {
    expect(canonicalAddress("  Bob+news@Corp.COM ")).toBe("bob@corp.com");
  });

  it("collapses dots and googlemail only for Gmail-style domains", () => {
    expect(canonicalAddress("b.o.b+x@googlemail.com")).toBe("bob@gmail.com");
    expect(canonicalAddress("B.O.B@gmail.com")).toBe("bob@gmail.com");
    expect(canonicalAddress("b.o.b@corp.com")).toBe("b.o.b@corp.com");
  });
});
