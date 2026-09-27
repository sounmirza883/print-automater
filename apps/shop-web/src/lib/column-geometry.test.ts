import { MAX_BAR, MIN_GAP, columnLayout, columnPath, indexAt } from "./column-geometry";

const size = { width: 540, height: 240 };
const gutters = { left: 40, right: 0, top: 10, bottom: 30 };

describe("columnLayout", () => {
  it("grows every column from one baseline, capped at 24px, with at least a 2px gap", () => {
    const layout = columnLayout([3, 0, 9], size, gutters);
    const baseline = layout.plot.top + layout.plot.height;
    for (const column of layout.columns) {
      expect(column.y + column.height).toBeCloseTo(baseline);
      expect(column.width).toBeLessThanOrEqual(MAX_BAR);
    }
    expect(layout.columns[1]!.height).toBe(0);
    // The tallest value reaches the top tick (10), not the plot's edge.
    expect(layout.ticks.map((t) => t.value)).toEqual([0, 5, 10]);
    expect(layout.columns[2]!.height).toBeCloseTo(layout.plot.height * 0.9);
  });

  it("keeps neighbours apart even when there are many periods", () => {
    const layout = columnLayout(
      Array.from({ length: 90 }, (_, i) => i),
      size,
      gutters,
    );
    const [a, b] = layout.columns;
    expect(b!.x - (a!.x + a!.width)).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
  });

  it("draws negative or missing values as zero", () => {
    const layout = columnLayout([-5, Number.NaN, 2], size, gutters);
    expect(layout.columns[0]!.height).toBe(0);
    expect(layout.columns[1]!.height).toBe(0);
  });
});

describe("indexAt and columnPath", () => {
  it("selects the column whose band the pointer is in, clamped to the ends", () => {
    const layout = columnLayout([1, 2, 3, 4], size, gutters);
    expect(indexAt(layout, layout.columns[2]!.cx)).toBe(2);
    expect(indexAt(layout, 0)).toBe(0);
    expect(indexAt(layout, 10_000)).toBe(3);
  });

  it("draws a rounded top and square baseline, and nothing for a zero column", () => {
    expect(columnPath({ x: 0, y: 0, width: 10, height: 0 })).toBe("");
    const path = columnPath({ x: 0, y: 10, width: 10, height: 50 });
    expect(path.startsWith("M0,60")).toBe(true);
    expect(path).toContain("Q");
  });
});
