import { createElement } from "react";
import { UserRole } from "@print-automated/types";
import { PrinterRulesScreen } from "@/components/settings/printer-rules-screen";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { renderAs } from "@/components/test-session";

const NO_ACCESS = "don&#x27;t have access to";

describe("settings screens (permission gating, rendered)", () => {
  it.each([UserRole.SHOP_COUNTER, UserRole.OPERATOR, UserRole.PRINTER_MANAGER])(
    "shows %s no access to settings or printer rules",
    (role) => {
      expect(renderAs(role, createElement(SettingsScreen))).toContain(NO_ACCESS);
      expect(renderAs(role, createElement(PrinterRulesScreen))).toContain(NO_ACCESS);
    },
  );

  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER])("opens both for %s", (role) => {
    expect(renderAs(role, createElement(SettingsScreen))).not.toContain(NO_ACCESS);
    const rules = renderAs(role, createElement(PrinterRulesScreen));
    expect(rules).not.toContain(NO_ACCESS);
    expect(rules).toContain("Add rule");
    expect(rules).toContain("A printer named on a job, or chosen by hand, always");
  });
});
