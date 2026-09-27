import { createElement } from "react";
import { UserRole } from "@print-automated/types";
import { CustomersScreen } from "@/components/customers/customers-screen";
import { StaffScreen } from "@/components/staff/staff-screen";
import { renderAs } from "@/components/test-session";

const NO_ACCESS = "don&#x27;t have access to";

describe("staff and customer screens (permission gating, rendered)", () => {
  it.each([UserRole.SHOP_COUNTER, UserRole.OPERATOR, UserRole.PRINTER_MANAGER])(
    "keeps %s out of the staff roster",
    (role) => {
      const html = renderAs(role, createElement(StaffScreen));
      expect(html).toContain(NO_ACCESS);
      expect(html).not.toContain("Invite a person");
    },
  );

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER])("opens the roster for %s", (role) => {
    expect(renderAs(role, createElement(StaffScreen))).toContain("Invite a person");
  });

  it("gives counter staff create and edit on customers (CREATE_ORDERS / EDIT_ORDERS)", () => {
    expect(renderAs(UserRole.SHOP_COUNTER, createElement(CustomersScreen))).toContain(
      "Add customer",
    );
  });

  it("lets an operator view customers but not add them", () => {
    const html = renderAs(UserRole.OPERATOR, createElement(CustomersScreen));
    expect(html).not.toContain(NO_ACCESS);
    expect(html).not.toContain("Add customer");
  });
});
