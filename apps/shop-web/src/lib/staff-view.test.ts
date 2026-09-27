import { UserRole } from "@print-automated/types";
import {
  canActOnMember,
  canCancelInvite,
  grantableRoles,
  looksLikeEmail,
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
