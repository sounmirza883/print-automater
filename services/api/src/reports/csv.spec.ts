import { toCsv } from "./csv.js";

describe("toCsv (23.5)", () => {
  it("writes a header from the first row, flattens nested objects and quotes commas, quotes and newlines", () => {
    const csv = toCsv([
      { name: 'A, "B"', n: 1, nested: { x: 2, y: null } },
      { name: "line\nbreak", n: 3, nested: { x: 4, y: 5 } },
    ]);
    expect(csv).toBe(
      ["name,n,nested.x,nested.y", '"A, ""B""",1,2,', '"line\nbreak",3,4,5', ""].join("\r\n"),
    );
  });

  it("neutralises spreadsheet formulas (=, +, -, @, tab, CR) with a leading apostrophe", () => {
    const csv = toCsv([{ a: "=SUM(A1)", b: "+1", c: "-2", d: "@x", e: "ok" }]);
    expect(csv.split("\r\n")[1]).toBe("'=SUM(A1),'+1,'-2,'@x,ok");
  });

  it("does not touch numbers, including negatives", () => {
    expect(toCsv([{ n: -5 }]).split("\r\n")[1]).toBe("-5");
  });

  it("an empty report is just an empty string (no header to infer)", () => {
    expect(toCsv([])).toBe("");
  });

  it("uses the supplied columns even when there are no rows", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b\r\n");
  });
});
