import { tokens } from "./tokens.js";

const HEX_COLOR = /^#[0-9A-F]{6}$/;

describe("tokens", () => {
  it("defines exactly the five §94 semantic colors, each a valid 6-digit hex", () => {
    expect(Object.keys(tokens.colors).sort()).toEqual(
      ["error", "neutral", "primaryAction", "success", "warning"].sort(),
    );
    for (const hex of Object.values(tokens.colors)) {
      expect(hex).toMatch(HEX_COLOR);
    }
  });

  it("orders the typography scale from smallest to largest font size", () => {
    const sizes = Object.values(tokens.typography.scale).map((step) => step.fontSize);
    const sorted = [...sizes].sort((a, b) => a - b);
    expect(sizes).toEqual(sorted);
    // Strictly increasing -- no two steps collapse to the same size.
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("orders the spacing scale from smallest to largest, starting at 0", () => {
    const steps = ["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16"] as const;
    const values = steps.map((step) => tokens.spacing[step]);
    expect(values[0]).toBe(0);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("orders the elevation and border-width scales from smallest to largest", () => {
    const elevationValues = Object.values(tokens.elevation);
    expect(elevationValues).toEqual([...elevationValues].sort((a, b) => a - b));

    const borderWidths = Object.values(tokens.borders.width);
    expect(borderWidths).toEqual([...borderWidths].sort((a, b) => a - b));
  });
});
