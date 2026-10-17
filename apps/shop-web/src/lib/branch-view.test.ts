import { Permission, UserRole } from "@print-automated/types";
import { branchStatus, canOpenClose, changedBranchFields, validateBranchForm } from "./branch-view";

const owner = {
  permissions: new Set<Permission>([Permission.MANAGE_SETTINGS, Permission.MANAGE_USERS]),
  role: UserRole.SHOP_OWNER,
  branchId: null,
};
const managerOfA = {
  permissions: new Set<Permission>([Permission.MANAGE_USERS]),
  role: UserRole.SHOP_MANAGER,
  branchId: "a",
};
const roamingManager = { ...managerOfA, branchId: null };
const counterOfA = {
  permissions: new Set<Permission>([Permission.VIEW_STAFF_DIRECTORY]),
  role: UserRole.SHOP_COUNTER,
  branchId: "a",
};

describe("branchStatus", () => {
  it("reads open, closed and archived", () => {
    expect(branchStatus({ isOpen: true, archivedAt: null })).toBe("open");
    expect(branchStatus({ isOpen: false, archivedAt: null })).toBe("closed");
  });

  it("calls an archived branch archived whatever its switch says", () => {
    expect(branchStatus({ isOpen: true, archivedAt: "2026-10-17T10:00:00.000Z" })).toBe("archived");
  });
});

describe("canOpenClose", () => {
  const active = (id: string) => ({ id, archivedAt: null });

  it("lets an owner open or close any branch", () => {
    expect(canOpenClose(owner, active("a"))).toBe(true);
    expect(canOpenClose(owner, active("b"))).toBe(true);
  });

  it("lets a manager open or close only their own branch", () => {
    expect(canOpenClose(managerOfA, active("a"))).toBe(true);
    expect(canOpenClose(managerOfA, active("b"))).toBe(false);
  });

  it("does not let an all-branches manager who is not an owner open or close branches", () => {
    expect(canOpenClose(roamingManager, active("a"))).toBe(false);
  });

  it("does not let anyone else", () => {
    expect(canOpenClose(counterOfA, active("a"))).toBe(false);
  });

  it("never offers it for an archived branch", () => {
    expect(canOpenClose(owner, { id: "a", archivedAt: "2026-10-17T10:00:00.000Z" })).toBe(false);
  });
});

describe("validateBranchForm", () => {
  it("accepts a name and an address", () => {
    expect(validateBranchForm({ name: "Gulberg", address: "5 Side Street" })).toEqual({});
  });

  it("asks for a name and an address", () => {
    const errors = validateBranchForm({ name: "   ", address: "" });
    expect(errors.name).toMatch(/name/i);
    expect(errors.address).toMatch(/address/i);
  });

  it("keeps the fields within the same limits as the business", () => {
    expect(validateBranchForm({ name: "x".repeat(201), address: "a" }).name).toMatch(/200/);
    expect(validateBranchForm({ name: "x".repeat(200), address: "a" }).name).toBeUndefined();
    expect(validateBranchForm({ name: "n", address: "a".repeat(501) }).address).toMatch(/500/);
    expect(validateBranchForm({ name: "n", address: "a".repeat(500) }).address).toBeUndefined();
    expect(validateBranchForm({ name: "n", address: "a", phone: "9".repeat(51) }).phone).toMatch(
      /50/,
    );
    expect(
      validateBranchForm({ name: "n", address: "a", phone: "9".repeat(50) }).phone,
    ).toBeUndefined();
  });
});

describe("changedBranchFields", () => {
  const branch = { name: "Main", city: "Lahore", address: "1 Mall Road", phone: "0300 111" };

  it("sends nothing when nothing changed, so an untouched field can never fail", () => {
    expect(
      changedBranchFields(branch, {
        name: "Main",
        city: "Lahore",
        address: "1 Mall Road",
        phone: "0300 111",
      }),
    ).toEqual({});
  });

  it("sends only the fields that changed", () => {
    expect(
      changedBranchFields(branch, {
        name: "Main Branch",
        city: "Lahore",
        address: "1 Mall Road",
        phone: "0300 111",
      }),
    ).toEqual({ name: "Main Branch" });
  });

  it("trims what was typed before comparing", () => {
    expect(
      changedBranchFields(branch, {
        name: "  Main  ",
        city: " Lahore",
        address: "1 Mall Road ",
        phone: "0300 111",
      }),
    ).toEqual({});
  });

  it("sends null to clear an optional field that was emptied", () => {
    expect(
      changedBranchFields(branch, { name: "Main", city: "", address: "1 Mall Road", phone: "  " }),
    ).toEqual({ city: null, phone: null });
  });

  it("treats a branch with no city or phone as unchanged when they stay empty", () => {
    const bare = { name: "Main", city: null, address: "1 Mall Road", phone: null };
    expect(
      changedBranchFields(bare, { name: "Main", city: "", address: "1 Mall Road", phone: "" }),
    ).toEqual({});
  });
});
