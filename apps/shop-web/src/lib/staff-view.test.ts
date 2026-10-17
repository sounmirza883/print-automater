import { UserRole } from "@print-automated/types";
import {
  ALL_BRANCHES,
  branchLabel,
  branchOptions,
  branchToWire,
  canActOnMember,
  canCancelInvite,
  grantableRoles,
  looksLikeEmail,
  resolveBranchChoice,
  withCurrentBranch,
  withInviteCopy,
} from "./staff-view";

describe("grantableRoles", () => {
  it("offers SHOP_OWNER only to an owner", () => {
    expect(grantableRoles(UserRole.SHOP_OWNER)).toContain(UserRole.SHOP_OWNER);
    expect(grantableRoles(UserRole.SHOP_MANAGER)).not.toContain(UserRole.SHOP_OWNER);
    expect(grantableRoles(null)).not.toContain(UserRole.SHOP_OWNER);
    expect(grantableRoles(UserRole.SHOP_MANAGER)).toEqual([
      UserRole.SHOP_MANAGER,
      UserRole.SHOP_COUNTER,
      UserRole.OPERATOR,
      UserRole.PRINTER_MANAGER,
    ]);
  });
});

describe("canActOnMember", () => {
  it("keeps an owner's membership out of a manager's reach", () => {
    expect(canActOnMember(UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)).toBe(false);
    expect(canActOnMember(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER)).toBe(true);
    expect(canActOnMember(UserRole.SHOP_MANAGER, UserRole.OPERATOR)).toBe(true);
  });
});

describe("canCancelInvite", () => {
  it("never offers to cancel an invitation for a role above the caller's own", () => {
    expect(canCancelInvite(UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)).toBe(false);
    expect(canCancelInvite(UserRole.SHOP_MANAGER, UserRole.SHOP_MANAGER)).toBe(true);
    expect(canCancelInvite(UserRole.SHOP_MANAGER, UserRole.OPERATOR)).toBe(true);
    expect(canCancelInvite(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER)).toBe(true);
    expect(canCancelInvite(null, UserRole.OPERATOR)).toBe(false);
  });
});

describe("looksLikeEmail", () => {
  it("accepts a plausible address and rejects anything else", () => {
    expect(looksLikeEmail(" person@example.com ")).toBe(true);
    expect(looksLikeEmail("person@example")).toBe(false);
    expect(looksLikeEmail("per son@example.com")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
});

describe("withInviteCopy", () => {
  it("gives an invitation's rate limit its own wording and leaves other errors alone", () => {
    expect(withInviteCopy({ status: 429, error_code: "RATE_LIMITED", message: "x" })).toEqual({
      status: 429,
      error_code: "INVITE_RATE_LIMITED",
    });
    const other = { status: 403, error_code: "FORBIDDEN", message: "No." };
    expect(withInviteCopy(other)).toBe(other);
  });
});

describe("branchOptions", () => {
  const branches = [
    { id: "a", name: "Main", archivedAt: null },
    { id: "b", name: "Gulberg", archivedAt: null },
    { id: "c", name: "Old Town", archivedAt: "2026-10-05T10:00:00.000Z" },
  ];
  const owner = { role: UserRole.SHOP_OWNER, branchId: null };
  const managerOfA = { role: UserRole.SHOP_MANAGER, branchId: "a" };
  const roamingManager = { role: UserRole.SHOP_MANAGER, branchId: null };

  it("offers an owner every active branch plus all branches, for a non-owner role", () => {
    expect(branchOptions(owner, branches, { forRole: UserRole.SHOP_COUNTER })).toEqual([
      { value: "a", label: "Main" },
      { value: "b", label: "Gulberg" },
      { value: ALL_BRANCHES, label: "All branches" },
    ]);
  });

  it("never offers an archived branch", () => {
    const values = branchOptions(owner, branches, { forRole: UserRole.OPERATOR }).map(
      (o) => o.value,
    );
    expect(values).not.toContain("c");
  });

  it("offers a branch-bound manager only their own branch, and not all branches", () => {
    expect(branchOptions(managerOfA, branches, { forRole: UserRole.SHOP_COUNTER })).toEqual([
      { value: "a", label: "Main" },
    ]);
  });

  it("offers a manager who works at all branches every branch but not all branches", () => {
    expect(branchOptions(roamingManager, branches, { forRole: UserRole.SHOP_COUNTER })).toEqual([
      { value: "a", label: "Main" },
      { value: "b", label: "Gulberg" },
    ]);
  });

  it("offers nothing for an owner, who always works at all branches", () => {
    expect(branchOptions(owner, branches, { forRole: UserRole.SHOP_OWNER })).toEqual([]);
  });
});

describe("branchLabel and branchToWire", () => {
  it("names the branch, or says all branches", () => {
    expect(branchLabel("Gulberg")).toBe("Gulberg");
    expect(branchLabel(null)).toBe("All branches");
  });

  it("turns the picker's empty value into null (all branches) for the API", () => {
    expect(branchToWire(ALL_BRANCHES)).toBeNull();
    expect(branchToWire("b")).toBe("b");
  });
});

describe("choosing a branch is always deliberate", () => {
  const two = [
    { value: "a", label: "Main" },
    { value: "b", label: "Gulberg" },
    { value: ALL_BRANCHES, label: "All branches" },
  ];

  it("keeps 'nothing chosen' distinct from 'all branches'", () => {
    expect(ALL_BRANCHES).not.toBe("");
  });

  it("starts with nothing chosen when there is a real choice, even for an owner", () => {
    expect(resolveBranchChoice(two, "")).toBe("");
  });

  it("keeps a choice that is still on offer", () => {
    expect(resolveBranchChoice(two, "b")).toBe("b");
    expect(resolveBranchChoice(two, ALL_BRANCHES)).toBe(ALL_BRANCHES);
  });

  it("drops a choice that is no longer on offer (the role changed)", () => {
    expect(
      resolveBranchChoice(
        [
          { value: "a", label: "Main" },
          { value: "b", label: "Gulberg" },
        ],
        ALL_BRANCHES,
      ),
    ).toBe("");
  });

  it("picks the only branch when there is just one, so a branch manager never has to choose", () => {
    expect(resolveBranchChoice([{ value: "a", label: "Main" }], "")).toBe("a");
  });
});

describe("withCurrentBranch", () => {
  const options = [
    { value: "a", label: "Main" },
    { value: "b", label: "Gulberg" },
  ];

  it("leaves the options alone when the current branch is among them", () => {
    expect(withCurrentBranch(options, { value: "a", label: "Main" })).toEqual(options);
  });

  it("adds the current branch when it is not on offer, so it shows as selected (all branches for a manager who may not grant it)", () => {
    expect(withCurrentBranch(options, { value: ALL_BRANCHES, label: "All branches" })).toEqual([
      ...options,
      { value: ALL_BRANCHES, label: "All branches" },
    ]);
  });
});
