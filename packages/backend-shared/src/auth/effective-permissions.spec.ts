import { Permission } from "@print-automated/types";
import {
  OWNER_ONLY_PERMISSIONS,
  diffFromRole,
  effectivePermissions,
  normalizePermissions,
} from "./effective-permissions.js";
import { ROLE_PERMISSIONS } from "./role-permissions.js";

const sorted = (list: readonly string[]): string[] => [...list].sort();

describe("effectivePermissions: role defaults plus per-person overrides", () => {
  it("is exactly the role's defaults when nothing is overridden", () => {
    expect(sorted(effectivePermissions("SHOP_COUNTER"))).toEqual(
      sorted(ROLE_PERMISSIONS.SHOP_COUNTER),
    );
  });

  it("adds a granted permission to a counter", () => {
    const held = effectivePermissions("SHOP_COUNTER", {
      extraPermissions: [Permission.VIEW_INVENTORY],
    });
    expect(held).toContain(Permission.VIEW_INVENTORY);
    expect(held).toContain(Permission.VIEW_ORDERS);
  });

  it("takes a permission away from a manager and keeps the rest", () => {
    const held = effectivePermissions("SHOP_MANAGER", {
      removedPermissions: [Permission.VIEW_REPORTS],
    });
    expect(held).not.toContain(Permission.VIEW_REPORTS);
    expect(held).toContain(Permission.MANAGE_USERS);
  });

  it("never restricts an owner", () => {
    const held = effectivePermissions("SHOP_OWNER", {
      removedPermissions: [Permission.MANAGE_USERS],
    });
    expect(sorted(held)).toEqual(sorted(ROLE_PERMISSIONS.SHOP_OWNER));
  });
});

describe("normalizePermissions", () => {
  it("adds the view permission a manage permission needs", () => {
    expect(normalizePermissions([Permission.MANAGE_INVENTORY])).toContain(
      Permission.VIEW_INVENTORY,
    );
    expect(normalizePermissions([Permission.MANAGE_PRINTERS])).toContain(Permission.VIEW_PRINTERS);
    expect(normalizePermissions([Permission.EDIT_ORDERS])).toContain(Permission.VIEW_ORDERS);
  });

  it("removes duplicates", () => {
    const result = normalizePermissions([Permission.VIEW_ORDERS, Permission.VIEW_ORDERS]);
    expect(result.filter((p) => p === Permission.VIEW_ORDERS)).toHaveLength(1);
  });
});

describe("diffFromRole", () => {
  it("is empty when the desired list equals the role defaults", () => {
    expect(diffFromRole("SHOP_MANAGER", ROLE_PERMISSIONS.SHOP_MANAGER)).toEqual({
      extraPermissions: [],
      removedPermissions: [],
    });
  });

  it("round-trips a counter who was given VIEW_REPORTS", () => {
    const desired = [...ROLE_PERMISSIONS.SHOP_COUNTER, Permission.VIEW_REPORTS];
    const diff = diffFromRole("SHOP_COUNTER", desired);
    expect(diff.extraPermissions).toEqual([Permission.VIEW_REPORTS]);
    expect(diff.removedPermissions).toEqual([]);
    expect(sorted(effectivePermissions("SHOP_COUNTER", diff))).toEqual(sorted(desired));
  });

  it("records what was taken away", () => {
    const desired = ROLE_PERMISSIONS.SHOP_MANAGER.filter((p) => p !== Permission.MANAGE_PRICES);
    expect(diffFromRole("SHOP_MANAGER", desired).removedPermissions).toEqual([
      Permission.MANAGE_PRICES,
    ]);
  });
});

describe("OWNER_ONLY_PERMISSIONS", () => {
  it("is business settings only", () => {
    expect(OWNER_ONLY_PERMISSIONS).toEqual([Permission.MANAGE_SETTINGS]);
  });
});
