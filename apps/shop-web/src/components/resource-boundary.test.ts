import { createElement, type ComponentType } from "react";
import { Permission, UserRole } from "@print-automated/types";
import { RequirePermission } from "@/components/resource-boundary";
import { renderAs } from "@/components/test-session";

// `children` is passed as a createElement argument (the lint rule forbids the prop form), which
// the component's required-children props type cannot express; hence the loose view of it.
const Gate = RequirePermission as unknown as ComponentType<Record<string, unknown>>;

const gated = (permission: Permission) =>
  createElement(Gate, { permission, what: "reports" }, createElement("p", null, "SECRET NUMBERS"));

describe("RequirePermission", () => {
  it("shows the screen to a role that holds the permission", () => {
    expect(renderAs(UserRole.SHOP_OWNER, gated(Permission.VIEW_REPORTS))).toContain(
      "SECRET NUMBERS",
    );
  });

  it("shows the no-access state, not the screen, to a role that does not", () => {
    const html = renderAs(UserRole.SHOP_COUNTER, gated(Permission.VIEW_REPORTS));
    expect(html).not.toContain("SECRET NUMBERS");
    expect(html).toContain("You don&#x27;t have access to reports");
  });

  it("decides by the role at the business, so an operator cannot see revenue screens", () => {
    expect(renderAs(UserRole.OPERATOR, gated(Permission.VIEW_DASHBOARD))).not.toContain(
      "SECRET NUMBERS",
    );
  });
});
