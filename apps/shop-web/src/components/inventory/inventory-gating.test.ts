import { createElement } from "react";
import { UserRole } from "@print-automated/types";
import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { InventoryItemScreen } from "@/components/inventory/inventory-item-screen";
import { renderAs } from "@/components/test-session";

describe("inventory screens (permission gating, rendered)", () => {
  it("shows counter staff the no-access state on both screens (no VIEW_INVENTORY)", () => {
    const list = renderAs(UserRole.SHOP_COUNTER, createElement(InventoryScreen));
    expect(list).toContain("You don&#x27;t have access to inventory");
    expect(list).not.toContain("Add stock item");
    expect(
      renderAs(UserRole.SHOP_COUNTER, createElement(InventoryItemScreen, { itemId: "i1" })),
    ).toContain("You don&#x27;t have access to inventory");
  });

  it("lets an operator view but not change stock: no add button", () => {
    const html = renderAs(UserRole.OPERATOR, createElement(InventoryScreen));
    expect(html).not.toContain("don&#x27;t have access");
    expect(html).not.toContain("Add stock item");
  });

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER])("gives %s the add button", (role) => {
    expect(renderAs(role, createElement(InventoryScreen))).toContain("Add stock item");
  });
});
