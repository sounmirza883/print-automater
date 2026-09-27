import { createElement } from "react";
import { UserRole } from "@print-automated/types";

let search = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

import { ReportsScreen } from "@/components/reports/reports-screen";
import { renderAs } from "@/components/test-session";

describe("reports screen (permission gating, rendered)", () => {
  beforeEach(() => {
    search = "";
  });

  it.each([UserRole.SHOP_COUNTER, UserRole.OPERATOR, UserRole.PRINTER_MANAGER])(
    "shows %s the no-access state (no VIEW_REPORTS)",
    (role) => {
      const html = renderAs(role, createElement(ReportsScreen));
      expect(html).toContain("You don&#x27;t have access to reports");
      expect(html).not.toContain("Download CSV");
    },
  );

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER])(
    "opens the reports for %s with the filter row and every report",
    (role) => {
      const html = renderAs(role, createElement(ReportsScreen));
      expect(html).not.toContain("don&#x27;t have access");
      expect(html).toContain("Download CSV");
      for (const title of ["Orders", "Revenue", "Printing volume", "Operator workload"]) {
        expect(html).toContain(title);
      }
      expect(html).toContain("Group by");
    },
  );

  it("hides the grouping control for reports that have no periods", () => {
    search = "report=operator-workload";
    const html = renderAs(UserRole.SHOP_OWNER, createElement(ReportsScreen));
    expect(html).not.toContain("Group by");
    expect(html).toContain("Jobs recorded against each operator");
  });
});
