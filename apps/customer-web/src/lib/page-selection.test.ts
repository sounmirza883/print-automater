import { validatePageSelection } from "./page-selection.js";

describe("validatePageSelection", () => {
  it("accepts 'all pages'", () => {
    expect(validatePageSelection({ mode: "all" }, 10)).toBeNull();
  });

  it("accepts an in-bounds range", () => {
    expect(validatePageSelection({ mode: "range", from: 2, to: 5 }, 10)).toBeNull();
  });

  it("§4.6: blocks a range exceeding the document's real page count, with a specific message", () => {
    const message = validatePageSelection({ mode: "range", from: 1, to: 11 }, 10);
    expect(message).not.toBeNull();
    expect(message).toContain("10");
  });

  it("blocks a range starting before page 1", () => {
    expect(validatePageSelection({ mode: "range", from: 0, to: 5 }, 10)).not.toBeNull();
  });
});
