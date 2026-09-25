import { LEGACY_LIST_CAP } from "@print-automated/validation";
import { listResult, resolvePagination } from "./pagination.js";

describe("resolvePagination (23.6)", () => {
  it("no params = a legacy call: bounded, not paged", () => {
    expect(resolvePagination({})).toEqual({
      paged: false,
      take: LEGACY_LIST_CAP,
      skip: 0,
      limit: LEGACY_LIST_CAP,
      offset: 0,
    });
  });

  it("either param opts into the envelope and the other defaults (limit 50, offset 0)", () => {
    expect(resolvePagination({ offset: 20 })).toMatchObject({
      paged: true,
      take: 50,
      skip: 20,
      limit: 50,
      offset: 20,
    });
    expect(resolvePagination({ limit: 10 })).toMatchObject({ paged: true, take: 10, skip: 0 });
    expect(resolvePagination({ limit: 100, offset: 0 })).toMatchObject({ paged: true, take: 100 });
  });
});

describe("listResult (23.6)", () => {
  it("a paged call gets the envelope with the total", () => {
    const p = resolvePagination({ limit: 2, offset: 4 });
    expect(listResult(p, ["a", "b"], 9)).toEqual({
      items: ["a", "b"],
      total: 9,
      limit: 2,
      offset: 4,
    });
  });

  it("a legacy call gets the bare array", () => {
    expect(listResult(resolvePagination({}), ["a"], 1)).toEqual(["a"]);
  });
});
