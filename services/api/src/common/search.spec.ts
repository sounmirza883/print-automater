import { escapeLike, ilike } from "./search.js";

const BS = "\\";

describe("search helpers (23.6)", () => {
  it("escapeLike neutralises LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("100%")).toBe(`100${BS}%`);
    expect(escapeLike("a_b")).toBe(`a${BS}_b`);
    expect(escapeLike(`c:${BS}dir`)).toBe(`c:${BS}${BS}dir`);
    expect(escapeLike("plain")).toBe("plain");
  });

  it("ilike builds a case-insensitive contains filter on the escaped text", () => {
    expect(ilike("50%_")).toEqual({ contains: `50${BS}%${BS}_`, mode: "insensitive" });
  });
});
