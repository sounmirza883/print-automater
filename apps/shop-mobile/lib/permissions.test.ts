import { Permission } from "@print-automated/types";
import { membershipCan, roleLabel } from "./permissions";

describe("membershipCan (23.32)", () => {
  it("allows exactly what the membership's list grants", () => {
    const can = membershipCan({ permissions: [Permission.PAUSE_JOBS, Permission.VIEW_ORDERS] });
    expect(can(Permission.PAUSE_JOBS)).toBe(true);
    expect(can(Permission.VIEW_ORDERS)).toBe(true);
    expect(can(Permission.EDIT_ORDERS)).toBe(false);
  });

  it("fails closed: no membership, or one without a list, allows nothing", () => {
    expect(membershipCan(null)(Permission.VIEW_ORDERS)).toBe(false);
    expect(membershipCan({})(Permission.VIEW_ORDERS)).toBe(false);
    expect(membershipCan({ permissions: [] })(Permission.VIEW_ORDERS)).toBe(false);
  });

  it("words the staff roles", () => {
    expect(roleLabel("OPERATOR")).toBe("Operator");
    expect(roleLabel("SHOP_OWNER")).toBe("Owner");
    expect(roleLabel(null)).toBe("Staff");
  });
});
