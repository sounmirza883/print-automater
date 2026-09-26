import { UserRole } from "@prisma/client";
import { ROLE_PERMISSIONS } from "./role-permissions.js";

describe("ROLE_PERMISSIONS (§47/16.2)", () => {
  it("has an entry for every UserRole, even if empty", () => {
    for (const role of Object.values(UserRole)) {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it("gives CUSTOMER and SUPPLIER no shop-side permissions", () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
    expect(ROLE_PERMISSIONS.SUPPLIER).toEqual([]);
  });

  it("gives SHOP_OWNER strictly more than SHOP_MANAGER (MANAGE_SETTINGS)", () => {
    const owner = new Set(ROLE_PERMISSIONS.SHOP_OWNER);
    const manager = new Set(ROLE_PERMISSIONS.SHOP_MANAGER);
    for (const permission of manager) {
      expect(owner.has(permission)).toBe(true);
    }
    expect(owner.size).toBeGreaterThan(manager.size);
  });

  it("never grants SHOP_COUNTER MANAGE_PRINTERS or MANAGE_USERS", () => {
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("MANAGE_PRINTERS");
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("MANAGE_USERS");
  });

  it("pause/resume (21.1): held by the production roles (same set as ASSIGN_JOBS), never SHOP_COUNTER or customers", () => {
    for (const role of ["OPERATOR", "PRINTER_MANAGER", "SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("PAUSE_JOBS");
    }
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("PAUSE_JOBS");
    expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain("PAUSE_JOBS");
  });

  it("failure reasons (21.2): held by exactly the roles that hold PAUSE_JOBS", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      expect(ROLE_PERMISSIONS[role].includes("RECORD_JOB_FAILURE")).toBe(
        ROLE_PERMISSIONS[role].includes("PAUSE_JOBS"),
      );
    }
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("RECORD_JOB_FAILURE");
  });

  it("quality check (21.3): held by the production roles, never SHOP_COUNTER", () => {
    for (const role of ["OPERATOR", "PRINTER_MANAGER", "SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("QUALITY_CHECK");
    }
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("QUALITY_CHECK");
  });

  it("reprint (21.4): manager, owner and printer manager only, never OPERATOR or SHOP_COUNTER", () => {
    for (const role of ["PRINTER_MANAGER", "SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("REPRINT_JOBS");
    }
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("REPRINT_JOBS");
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("REPRINT_JOBS");
  });

  it("delivery (21.5): counter, manager and owner manage it; operator and printer manager do not", () => {
    for (const role of ["SHOP_COUNTER", "SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("MANAGE_DELIVERY");
    }
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("MANAGE_DELIVERY");
    expect(ROLE_PERMISSIONS.PRINTER_MANAGER).not.toContain("MANAGE_DELIVERY");
  });

  it("inventory (20.2): operators and printer managers may view, only manager/owner may manage, counter neither", () => {
    expect(ROLE_PERMISSIONS.OPERATOR).toContain("VIEW_INVENTORY");
    expect(ROLE_PERMISSIONS.PRINTER_MANAGER).toContain("VIEW_INVENTORY");
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("MANAGE_INVENTORY");
    expect(ROLE_PERMISSIONS.PRINTER_MANAGER).not.toContain("MANAGE_INVENTORY");
    for (const role of ["SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_INVENTORY");
      expect(ROLE_PERMISSIONS[role]).toContain("MANAGE_INVENTORY");
    }
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("VIEW_INVENTORY");
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("MANAGE_INVENTORY");
    // every role that can manage can also view (a manage-only role could not see what it edits)
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      if (ROLE_PERMISSIONS[role].includes("MANAGE_INVENTORY")) {
        expect(ROLE_PERMISSIONS[role]).toContain("VIEW_INVENTORY");
      }
    }
  });
  it("settings (22.1): owner and manager may view; only the owner manages business settings; manager also manages automation", () => {
    for (const role of ["SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_SETTINGS");
      expect(ROLE_PERMISSIONS[role]).toContain("MANAGE_AUTOMATION");
    }
    expect(ROLE_PERMISSIONS.SHOP_OWNER).toContain("MANAGE_SETTINGS");
    // The owner/manager boundary of 16.3 stands: business-level configuration stays owner-only.
    expect(ROLE_PERMISSIONS.SHOP_MANAGER).not.toContain("MANAGE_SETTINGS");
    for (const role of ["SHOP_COUNTER", "OPERATOR", "PRINTER_MANAGER", "CUSTOMER"] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("VIEW_SETTINGS");
      expect(ROLE_PERMISSIONS[role]).not.toContain("MANAGE_AUTOMATION");
    }
    // whoever can manage anything here can also view it
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      if (
        ROLE_PERMISSIONS[role].includes("MANAGE_SETTINGS") ||
        ROLE_PERMISSIONS[role].includes("MANAGE_AUTOMATION")
      ) {
        expect(ROLE_PERMISSIONS[role]).toContain("VIEW_SETTINGS");
      }
    }
  });
  it("dashboards (23.2): business dashboard is owner/manager only; operator and printer dashboards go to the production roles; counter and customers get none", () => {
    for (const role of ["SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_DASHBOARD");
    }
    for (const role of ["OPERATOR", "PRINTER_MANAGER"] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("VIEW_DASHBOARD");
    }
    for (const role of ["OPERATOR", "PRINTER_MANAGER", "SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_OPERATOR_DASHBOARD");
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_PRINTER_DASHBOARD");
    }
    for (const role of ["SHOP_COUNTER", "CUSTOMER", "SUPPLIER"] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("VIEW_DASHBOARD");
      expect(ROLE_PERMISSIONS[role]).not.toContain("VIEW_OPERATOR_DASHBOARD");
      expect(ROLE_PERMISSIONS[role]).not.toContain("VIEW_PRINTER_DASHBOARD");
    }
  });
  it("reports (23.5): VIEW_REPORTS is owner and manager only; operators, printer managers, counter and customers never see them", () => {
    for (const role of ["SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_REPORTS");
    }
    for (const role of [
      "OPERATOR",
      "PRINTER_MANAGER",
      "SHOP_COUNTER",
      "CUSTOMER",
      "SUPPLIER",
    ] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("VIEW_REPORTS");
    }
  });

  it("VIEW_PRINTERS (23.14): every shop staff role can read printers; only the fleet roles can manage them", () => {
    for (const role of [
      "SHOP_COUNTER",
      "OPERATOR",
      "PRINTER_MANAGER",
      "SHOP_MANAGER",
      "SHOP_OWNER",
    ] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_PRINTERS");
    }
    for (const role of ["SHOP_COUNTER", "OPERATOR"] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("MANAGE_PRINTERS");
    }
    expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain("VIEW_PRINTERS");
    // Anyone who can manage printers can also read them.
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      if (ROLE_PERMISSIONS[role].includes("MANAGE_PRINTERS")) {
        expect(ROLE_PERMISSIONS[role]).toContain("VIEW_PRINTERS");
      }
    }
  });

  it("VIEW_STAFF_DIRECTORY (23.15): every shop staff role, no customer, and it does not imply MANAGE_USERS", () => {
    for (const role of [
      "SHOP_COUNTER",
      "OPERATOR",
      "PRINTER_MANAGER",
      "SHOP_MANAGER",
      "SHOP_OWNER",
    ] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_STAFF_DIRECTORY");
    }
    expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain("VIEW_STAFF_DIRECTORY");
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("MANAGE_USERS");
  });
});
