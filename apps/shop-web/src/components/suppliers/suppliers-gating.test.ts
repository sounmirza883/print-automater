import { createElement } from "react";
import { UserRole } from "@print-automated/types";
import { PurchaseOrderDetail } from "@/components/purchase-orders/po-detail";
import { PurchaseOrdersScreen } from "@/components/purchase-orders/po-screen";
import { SupplierDetail } from "@/components/suppliers/supplier-detail";
import { SuppliersScreen } from "@/components/suppliers/suppliers-screen";
import { renderAs } from "@/components/test-session";

const NO_ACCESS = "don&#x27;t have access to";

describe("supplier and purchase-order screens (permission gating, rendered)", () => {
  it.each([UserRole.SHOP_COUNTER, UserRole.OPERATOR, UserRole.PRINTER_MANAGER])(
    "shows %s the no-access state for suppliers and purchase orders",
    (role) => {
      expect(renderAs(role, createElement(SuppliersScreen))).toContain(NO_ACCESS);
      expect(renderAs(role, createElement(SupplierDetail, { supplierId: "s1" }))).toContain(
        NO_ACCESS,
      );
      expect(renderAs(role, createElement(PurchaseOrdersScreen))).toContain(NO_ACCESS);
      expect(renderAs(role, createElement(PurchaseOrderDetail, { orderId: "p1" }))).toContain(
        NO_ACCESS,
      );
    },
  );

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER])(
    "opens both for %s with their create buttons",
    (role) => {
      const suppliers = renderAs(role, createElement(SuppliersScreen));
      expect(suppliers).not.toContain(NO_ACCESS);
      expect(suppliers).toContain("Add supplier");
      expect(renderAs(role, createElement(PurchaseOrdersScreen))).toContain("New purchase order");
    },
  );
});
