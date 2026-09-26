import { buildRuleInput, describeConditions, emptyRuleForm, moveRule } from "./printer-rules-view";

describe("buildRuleInput", () => {
  const ok = {
    ...emptyRuleForm(),
    name: "Colour to the plotter",
    printerIds: ["p2"],
    color: "COLOR",
  };

  it("builds a body with only the conditions that are set", () => {
    expect(buildRuleInput(ok)).toEqual({
      ok: true,
      input: {
        name: "Colour to the plotter",
        action: "PREFER",
        printerIds: ["p2"],
        conditions: { color: "COLOR" },
        enabled: true,
      },
    });
    const wide = buildRuleInput({ ...ok, minPages: "200", paperSize: "A3" });
    expect(wide.ok && wide.input.conditions).toEqual({
      paperSize: "A3",
      color: "COLOR",
      minPages: 200,
    });
  });

  it("names every wrong field", () => {
    const bad = buildRuleInput({ ...emptyRuleForm(), name: " ", minPages: "0", maxPages: "x" });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(Object.keys(bad.errors).sort()).toEqual([
        "maxPages",
        "minPages",
        "name",
        "printerIds",
      ]);
  });

  it("rejects a maximum below the minimum", () => {
    const bad = buildRuleInput({ ...ok, minPages: "100", maxPages: "50" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.maxPages).toMatch(/below the minimum/);
  });
});

describe("describeConditions", () => {
  it("reads as a sentence", () => {
    expect(describeConditions({})).toBe("Every job");
    expect(
      describeConditions({ color: "COLOR", sides: "DOUBLE", minPages: 10, maxPages: 50 }),
    ).toBe("Jobs with colour, double-sided, 10 to 50 pages");
    expect(describeConditions({ minPages: 200 })).toBe("Jobs with 200 pages or more");
  });
});

describe("moveRule", () => {
  it("swaps neighbours and always returns every id", () => {
    expect(moveRule(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveRule(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("does nothing past either end or for an unknown id", () => {
    expect(moveRule(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveRule(["a", "b"], "b", 1)).toEqual(["a", "b"]);
    expect(moveRule(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});
