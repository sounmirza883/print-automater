import { jobPages } from "./job-pages.js";

describe("jobPages", () => {
  it("is resolved page count x copies", () => {
    expect(jobPages(7, 3)).toBe(21);
  });
  it("defaults missing copies (legacy job with no order item) to 1", () => {
    expect(jobPages(7, null)).toBe(7);
    expect(jobPages(7, undefined)).toBe(7);
  });
  it("defaults an unknown page count to 1", () => {
    expect(jobPages(null, 2)).toBe(2);
  });
});
