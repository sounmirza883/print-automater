import { createElement } from "react";
import { UserRole } from "@print-automated/types";
import { ProductsScreen } from "@/components/products/products-screen";
import { renderAs } from "@/components/test-session";

describe("products screen (permission gating, rendered)", () => {
  it.each([UserRole.SHOP_COUNTER, UserRole.OPERATOR, UserRole.PRINTER_MANAGER])(
    "shows %s the no-access state",
    (role) => {
      const html = renderAs(role, createElement(ProductsScreen));
      expect(html).toContain("don&#x27;t have access to products and pricing");
      expect(html).not.toContain("Add product");
    },
  );

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER])(
    "opens for %s with the price-change promise stated",
    (role) => {
      const html = renderAs(role, createElement(ProductsScreen));
      expect(html).toContain("Add product");
      expect(html).toContain("never changes an order that is already confirmed");
    },
  );
});
