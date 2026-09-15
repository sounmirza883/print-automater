import { resolvePageCount } from "./resolve-page-count.js";
import { InvalidPageSelectionError } from "./types.js";

describe("resolvePageCount", () => {
  it("resolves 'all' to the document's full page count", () => {
    expect(resolvePageCount({ mode: "all" }, 42)).toBe(42);
  });

  it("resolves an inclusive range to its span", () => {
    expect(resolvePageCount({ mode: "range", from: 3, to: 7 }, 100)).toBe(5);
    expect(resolvePageCount({ mode: "range", from: 1, to: 1 }, 100)).toBe(1);
  });

  it("rejects a range starting before page 1", () => {
    expect(() => resolvePageCount({ mode: "range", from: 0, to: 5 }, 100)).toThrow(
      InvalidPageSelectionError,
    );
  });

  it("rejects a range where to < from", () => {
    expect(() => resolvePageCount({ mode: "range", from: 8, to: 5 }, 100)).toThrow(
      InvalidPageSelectionError,
    );
  });

  it("rejects a range that exceeds the document's actual page count", () => {
    expect(() => resolvePageCount({ mode: "range", from: 1, to: 101 }, 100)).toThrow(
      InvalidPageSelectionError,
    );
  });

  it("rejects a non-positive or non-integer document page count", () => {
    expect(() => resolvePageCount({ mode: "all" }, 0)).toThrow(InvalidPageSelectionError);
    expect(() => resolvePageCount({ mode: "all" }, -3)).toThrow(InvalidPageSelectionError);
    expect(() => resolvePageCount({ mode: "all" }, 1.5)).toThrow(InvalidPageSelectionError);
  });
});
