import { createElement, type ContextType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchSummary, MyShopMembership } from "@print-automated/api-client";
import { UserRole } from "@print-automated/types";
import { SessionContext } from "@/components/session-provider";
import { membershipPermissions } from "@/lib/permissions";
import { serverPermissionsFor } from "@/components/test-role-permissions";

type SessionValue = NonNullable<ContextType<typeof SessionContext>>;

/** The branch half of a session for a business with one branch: nothing to choose and nothing
 * to label, which is what most screens are tested as. */
export const SINGLE_BRANCH_SESSION: Pick<
  SessionValue,
  | "branches"
  | "branchesReady"
  | "branch"
  | "branchMode"
  | "branchFilter"
  | "showBranchColumn"
  | "selectBranch"
  | "reloadBranches"
> = {
  branches: [],
  branchesReady: true,
  branch: null,
  branchMode: "single",
  branchFilter: undefined,
  showBranchColumn: false,
  selectBranch: () => undefined,
  reloadBranches: () => undefined,
};

/** A branch as the API lists it, for tests that need a few of them. */
export function testBranch(id: string, name: string): BranchSummary {
  return {
    id,
    shopId: "shop-1",
    name,
    city: null,
    address: "1 Test Road",
    phone: null,
    isOpen: true,
    openingHours: null,
    archivedAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    staffCount: 1,
    managers: [],
  };
}

/** Test helper: render `node` as a signed-in person holding `role` at one
 * business, exactly as `SessionProvider` would expose it. `membership` adds to
 * the person's membership (a branch-bound manager has `branchId` and
 * `branchName`); `branch` replaces parts of the branch half of the session. */
export function renderAs(
  role: UserRole,
  node: ReactNode,
  options: {
    membership?: Partial<MyShopMembership>;
    branch?: Partial<typeof SINGLE_BRANCH_SESSION>;
  } = {},
): string {
  // Built exactly as SessionProvider builds it: from the membership's own list.
  const business = {
    id: "shop-1",
    name: "Mock Print Co",
    role,
    permissions: serverPermissionsFor(role),
    ...options.membership,
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
          ...SINGLE_BRANCH_SESSION,
          ...options.branch,
        },
      },
      node,
    ),
  );
}
