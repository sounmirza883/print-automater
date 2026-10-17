import { ForbiddenException } from "@nestjs/common";
import { resolveBranchScope } from "./branch-scope.js";

describe("resolveBranchScope", () => {
  it("pins a branch-bound caller to their own branch when they ask for nothing", () => {
    expect(resolveBranchScope("branch-a", undefined)).toBe("branch-a");
  });

  it("lets a branch-bound caller name their own branch", () => {
    expect(resolveBranchScope("branch-a", "branch-a")).toBe("branch-a");
  });

  it("refuses a branch-bound caller who names another branch", () => {
    expect(() => resolveBranchScope("branch-a", "branch-b")).toThrow(ForbiddenException);
  });

  it("leaves an all-branches caller unfiltered unless they ask", () => {
    expect(resolveBranchScope(null, undefined)).toBeUndefined();
    expect(resolveBranchScope(null, "branch-b")).toBe("branch-b");
  });
});
