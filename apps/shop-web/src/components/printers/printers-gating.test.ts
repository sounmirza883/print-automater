import { createElement } from "react";
import { UserRole } from "@print-automated/types";
import { PrintersScreen } from "@/components/printers/printers-screen";
import { PrinterDetail } from "@/components/printers/printer-detail";
import { renderAs } from "@/components/test-session";

describe("printer screens (permission gating, rendered)", () => {
  it.each([UserRole.SHOP_COUNTER, UserRole.OPERATOR])(
    "shows %s the no-access state, never the management screen",
    (role) => {
      const list = renderAs(role, createElement(PrintersScreen));
      expect(list).toContain("You don&#x27;t have access to printers");
      expect(list).not.toContain("Add printer");
      const detail = renderAs(role, createElement(PrinterDetail, { printerId: "p1" }));
      expect(detail).toContain("You don&#x27;t have access to printers");
    },
  );

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER, UserRole.PRINTER_MANAGER])(
    "opens the management screen for %s",
    (role) => {
      const html = renderAs(role, createElement(PrintersScreen));
      expect(html).not.toContain("don&#x27;t have access");
      expect(html).toContain("Add printer");
    },
  );
});
