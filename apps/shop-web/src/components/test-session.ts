import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserRole } from "@print-automated/types";
import { SessionContext } from "@/components/session-provider";
import { membershipPermissions } from "@/lib/permissions";
import { serverPermissionsFor } from "@/components/test-role-permissions";

/** Test helper: render `node` as a signed-in person holding `role` at one
 * business, exactly as `SessionProvider` would expose it. */
export function renderAs(role: UserRole, node: ReactNode): string {
  // Built exactly as SessionProvider builds it: from the membership's own list.
  const business = {
    id: "shop-1",
    name: "Mock Print Co",
    role,
    permissions: serverPermissionsFor(role),
  };
  const permissions = membershipPermissions(business);
  return renderToStaticMarkup(
    createElement(
      SessionContext.Provider,
      {
        value: {
          user: { id: "u1", name: "Test", email: "t@example.com", role },
          memberships: [business],
          business,
          selectBusiness: () => undefined,
          businessRole: role,
          permissions,
          can: (permission) => permissions.has(permission),
          isAdmin: role === UserRole.ADMIN,
        },
      },
      node,
    ),
  );
}
