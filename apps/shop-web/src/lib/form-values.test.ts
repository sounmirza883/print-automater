import {
  basisPointsToPercent,
  changedFields,
  isEmail,
  nullableText,
  optionalText,
  parseWholeNumber,
  percentToBasisPoints,
} from "./form-values";

describe("text helpers", () => {
  it("maps blank to undefined for creates and null for updates", () => {
    expect(optionalText("  ")).toBeUndefined();
    expect(optionalText(" a ")).toBe("a");
    expect(nullableText(" ")).toBeNull();
    expect(nullableText(" b ")).toBe("b");
  });
});

describe("parseWholeNumber", () => {
  it("accepts whole numbers in range and rejects everything else", () => {
    expect(parseWholeNumber("250")).toBe(250);
    expect(parseWholeNumber(" 0 ")).toBe(0);
    for (const bad of ["", "1.5", "abc", "-1", "1e3", "100000001"]) {
      expect(parseWholeNumber(bad)).toBeUndefined();
    }
    expect(parseWholeNumber("-5", { min: -10 })).toBe(-5);
    expect(parseWholeNumber("11", { max: 10 })).toBeUndefined();
  });
});

describe("tax percent <-> basis points", () => {
  it("converts exactly, without float drift", () => {
    expect(percentToBasisPoints("18")).toBe(1800);
    expect(percentToBasisPoints("17.5")).toBe(1750);
    expect(percentToBasisPoints("0.29")).toBe(29);
    expect(percentToBasisPoints("100")).toBe(10_000);
  });

  it("treats blank as no rate and rejects nonsense", () => {
    expect(percentToBasisPoints("")).toBeNull();
    for (const bad of ["-1", "101", "1.234", "abc", "18%"]) {
      expect(percentToBasisPoints(bad)).toBeUndefined();
    }
  });

  it("round-trips for display", () => {
    expect(basisPointsToPercent(1750)).toBe("17.5");
    expect(basisPointsToPercent(1800)).toBe("18");
    expect(basisPointsToPercent(null)).toBe("");
  });
});

describe("changedFields", () => {
  it("returns only what changed, comparing nested values by content", () => {
    expect(
      changedFields(
        { name: "A", limits: { a: 1 }, note: null as string | null },
        { name: "A", limits: { a: 2 }, note: null },
      ),
    ).toEqual({ limits: { a: 2 } });
    expect(changedFields({ x: 1 }, { x: 1 })).toEqual({});
  });
});

describe("isEmail", () => {
  it("does a plain sanity check (the API is the authority)", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("a b@c.d")).toBe(false);
  });
});
