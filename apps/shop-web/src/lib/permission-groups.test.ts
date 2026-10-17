import { Permission } from "@print-automated/types";
import {
  PERMISSION_GROUPS,
  disabledReason,
  grantableForEditor,
  impliedPermissions,
  isCustom,
  toggled,
} from "./permission-groups";

const set = (...items: Permission[]): ReadonlySet<Permission> => new Set(items);

describe("PERMISSION_GROUPS", () => {
  it("lists every permission exactly once, each with a plain label", () => {
    const listed = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.permission));
    expect([...listed].sort()).toEqual(Object.values(Permission).sort());
    for (const group of PERMISSION_GROUPS) {
      for (const item of group.items) {
        expect(item.label).not.toMatch(/_/);
      }
    }
  });
});

describe("impliedPermissions (mirrors the API's manage-implies-view)", () => {
  it("adds the read permission a manage permission needs", () => {
    expect(
      impliedPermissions(set(Permission.MANAGE_INVENTORY)).has(Permission.VIEW_INVENTORY),
    ).toBe(true);
    expect(impliedPermissions(set(Permission.EDIT_ORDERS)).has(Permission.VIEW_ORDERS)).toBe(true);
  });
});

describe("toggled", () => {
  it("ticking a manage permission also ticks its view permission", () => {
    const next = toggled(set(), Permission.MANAGE_PRINTERS, true);
    expect(next.has(Permission.MANAGE_PRINTERS)).toBe(true);
    expect(next.has(Permission.VIEW_PRINTERS)).toBe(true);
  });

  it("unticking a view permission also unticks what needs it", () => {
    const start = set(Permission.VIEW_INVENTORY, Permission.MANAGE_INVENTORY);
    const next = toggled(start, Permission.VIEW_INVENTORY, false);
    expect(next.has(Permission.VIEW_INVENTORY)).toBe(false);
    expect(next.has(Permission.MANAGE_INVENTORY)).toBe(false);
  });

  it("does not change the set it was given", () => {
    const start = set(Permission.VIEW_ORDERS);
    toggled(start, Permission.EDIT_ORDERS, true);
    expect(start.has(Permission.EDIT_ORDERS)).toBe(false);
  });
});

describe("grantableForEditor", () => {
  const editor = set(Permission.VIEW_ORDERS, Permission.MANAGE_USERS);
  const target = set(Permission.VIEW_ORDERS, Permission.VIEW_REPORTS);
  const can = grantableForEditor(editor, target);

  it("allows what the editor holds", () => {
    expect(can(Permission.MANAGE_USERS)).toBe(true);
  });

  it("refuses what neither the editor nor the person holds", () => {
    expect(can(Permission.MANAGE_PRICES)).toBe(false);
  });

  it("allows keeping what the person already holds even if the editor lacks it", () => {
    expect(can(Permission.VIEW_REPORTS)).toBe(true);
  });

  it("never allows business settings", () => {
    expect(
      grantableForEditor(set(Permission.MANAGE_SETTINGS), set())(Permission.MANAGE_SETTINGS),
    ).toBe(false);
  });

  it("says why a line is locked", () => {
    expect(disabledReason(editor, target, Permission.MANAGE_PRICES)).toMatch(/do not have/i);
    expect(disabledReason(editor, target, Permission.MANAGE_SETTINGS)).toMatch(/owner/i);
    expect(disabledReason(editor, target, Permission.MANAGE_USERS)).toBeNull();
  });
});

describe("isCustom", () => {
  it("is true only where the choice differs from the role's default", () => {
    const defaults = set(Permission.VIEW_ORDERS);
    const selected = set(Permission.VIEW_ORDERS, Permission.VIEW_REPORTS);
    expect(isCustom(Permission.VIEW_REPORTS, selected, defaults)).toBe(true);
    expect(isCustom(Permission.VIEW_ORDERS, selected, defaults)).toBe(false);
    expect(isCustom(Permission.VIEW_ORDERS, set(), defaults)).toBe(true);
  });
});
