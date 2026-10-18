/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required, so children go in the props object. Same as ui.test.ts. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserRole, type Permission } from "@print-automated/types";
import { ConsoleShell } from "@/components/console-shell";
import { SessionContext } from "@/components/session-provider";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { BranchSwitcher } from "@/components/shell/branch-switcher";
import { BusinessSwitcher } from "@/components/shell/business-switcher";
import { NavList } from "@/components/shell/nav-list";
import { SINGLE_BRANCH_SESSION, renderAs, testBranch } from "@/components/test-session";
import { serverPermissionsFor } from "@/components/test-role-permissions";
import { ThemeProvider } from "@/components/theme-provider";
import { membershipPermissions } from "@/lib/permissions";

let mockPathname = "/orders/abc";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function themed(node: ReactNode): ReactNode {
  return createElement(ThemeProvider, { initial: "system", children: node });
}

/** The anchors marked as the current page. */
function currentLinks(html: string): string[] {
  return html.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
}

/** A platform admin: no business at all. `renderAs` always supplies one, so build the session by hand. */
function renderAsPlatformAdmin(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(SessionContext.Provider, {
      value: {
        user: {
          id: "a1",
          name: "Platform Person",
          email: "admin@example.com",
          role: UserRole.ADMIN,
        },
        memberships: [],
        business: null,
        selectBusiness: () => undefined,
        businessRole: null,
        permissions: new Set<Permission>(),
        can: () => false,
        isAdmin: true,
        ...SINGLE_BRANCH_SESSION,
      },
      children: node,
    }),
  );
}

/** Someone in two businesses (owner of the first, manager of the second): `renderAs` supplies only one, so build the session by hand. */
function renderInTwoBusinesses(node: ReactNode): string {
  const first = {
    id: "shop-1",
    name: "First Print Co",
    role: UserRole.SHOP_OWNER,
    permissions: serverPermissionsFor(UserRole.SHOP_OWNER),
  };
  const second = {
    id: "shop-2",
    name: "Second Print Co",
    role: UserRole.SHOP_MANAGER,
    permissions: serverPermissionsFor(UserRole.SHOP_MANAGER),
  };
  const permissions = membershipPermissions(first);
  return renderToStaticMarkup(
    createElement(SessionContext.Provider, {
      value: {
        user: { id: "u1", name: "Test", email: "t@example.com", role: UserRole.SHOP_OWNER },
        memberships: [first, second],
        business: first,
        selectBusiness: () => undefined,
        businessRole: UserRole.SHOP_OWNER,
        permissions,
        can: (permission) => permissions.has(permission),
        isAdmin: false,
        ...SINGLE_BRANCH_SESSION,
      },
      children: node,
    }),
  );
}

beforeEach(() => {
  mockPathname = "/orders/abc";
});

describe("NavList", () => {
  it("shows an owner the section headings and marks only the open section current", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(NavList));
    for (const heading of ["Production", "Stock", "Catalogue", "Business"]) {
      expect(html).toContain(`>${heading}<`);
    }
    expect(html).not.toContain(">Platform<");
    const current = currentLinks(html);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/orders"');
  });

  it("shows no heading for a section the role cannot open", () => {
    const html = renderAs(UserRole.SHOP_COUNTER, createElement(NavList));
    expect(html).toContain(">Production<");
    expect(html).not.toContain(">Stock<");
    expect(html).not.toContain(">Business<");
  });

  it("marks only the more specific entry when a path sits under two of them", () => {
    mockPathname = "/admin/businesses/abc";
    const current = currentLinks(renderAsPlatformAdmin(createElement(NavList)));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/admin/businesses"');
  });
});

describe("BusinessSwitcher", () => {
  it("is plain text, not a menu, for someone with a single business", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(BusinessSwitcher));
    expect(html).toContain("Mock Print Co");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("<button");
  });

  it("renders nothing for a platform admin, who has no business", () => {
    expect(renderAsPlatformAdmin(createElement(BusinessSwitcher))).toBe("");
  });

  it("is a popover button naming the open business for someone in two", () => {
    const html = renderInTwoBusinesses(createElement(BusinessSwitcher));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("First Print Co");
  });
});

describe("BranchSwitcher", () => {
  const main = testBranch("a", "Main");
  const gulberg = testBranch("b", "Gulberg");
  /** An all-branches person in a business with two branches, looking at all of them. */
  const choosing = { branches: [main, gulberg], branchMode: "choice" as const, branch: null };

  it("shows nothing for a business with one branch, so it notices no new control", () => {
    expect(renderAs(UserRole.SHOP_OWNER, createElement(BranchSwitcher))).toBe("");
    expect(renderAs(UserRole.SHOP_OWNER, createElement(BranchSwitcher, { compact: true }))).toBe(
      "",
    );
  });

  it("renders nothing for a platform admin, who has no business", () => {
    expect(renderAsPlatformAdmin(createElement(BranchSwitcher))).toBe("");
  });

  it("is a popover button saying all branches for someone who works at all of several", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(BranchSwitcher), {
      branch: choosing,
    });
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("All branches");
  });

  it("names the branch the console is narrowed to", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(BranchSwitcher), {
      branch: { ...choosing, branch: gulberg },
    });
    expect(html).toContain("Gulberg");
    expect(html).not.toContain("All branches");
  });

  it("is a labelled button on the phone bar too", () => {
    const html = renderAs(UserRole.SHOP_OWNER, createElement(BranchSwitcher, { compact: true }), {
      branch: { ...choosing, branch: gulberg },
    });
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Gulberg");
  });

  it("is plain text, not a menu, for a branch-bound person: their own branch's name", () => {
    const html = renderAs(UserRole.SHOP_MANAGER, createElement(BranchSwitcher), {
      membership: { branchId: "a", branchName: "Main" },
      branch: { branches: [main], branchMode: "bound", branch: main },
    });
    expect(html).toContain("Main");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("<button");
  });

  it("still names a branch-bound person's branch when the branch list did not load", () => {
    const html = renderAs(UserRole.SHOP_MANAGER, createElement(BranchSwitcher), {
      membership: { branchId: "a", branchName: "Main" },
      branch: { branches: [], branchMode: "bound", branch: null },
    });
    expect(html).toContain("Main");
  });
});

describe("BottomTabs", () => {
  it("marks More, and no tab, as current on a screen that is not one of the tabs", () => {
    mockPathname = "/settings";
    const html = renderAs(UserRole.SHOP_OWNER, createElement(BottomTabs));
    expect(currentLinks(html)).toEqual([]);
    const more = html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>/)?.[0];
    expect(more).toBeDefined();
    expect(more).toContain("font-semibold");
  });
});

describe("ConsoleShell", () => {
  it("frames a screen with the skip link, the main landmark and the phone tab bar", () => {
    const html = renderAs(
      UserRole.SHOP_OWNER,
      themed(createElement(ConsoleShell, { children: "SCREEN-BODY" })),
    );
    expect(html).toContain("Skip to content");
    expect(html).toContain('id="main"');
    expect(html).toContain("SCREEN-BODY");
    expect(html).toContain("Search or jump to");
    for (const tab of ["Home", "Orders", "Printers", "Stock", "More"]) {
      expect(html).toContain(`>${tab}<`);
    }
  });

  it("has exactly one skip link and one main landmark", () => {
    const html = renderAs(
      UserRole.SHOP_OWNER,
      themed(createElement(ConsoleShell, { children: "SCREEN-BODY" })),
    );
    expect(html.match(/Skip to content/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  it("adds no branch control to the shell of a one-branch business", () => {
    const html = renderAs(
      UserRole.SHOP_OWNER,
      themed(createElement(ConsoleShell, { children: "SCREEN-BODY" })),
    );
    // (The owner's "Branches" page is in the navigation: this is about the switcher and label.)
    expect(html).not.toContain("Switch branch");
    expect(html).not.toContain("Branch: ");
    expect(html).not.toContain(">Branch<");
  });

  it("names a branch-bound manager's branch in the sidebar and on the phone bar, with no menu", () => {
    const main = testBranch("a", "Main");
    const html = renderAs(
      UserRole.SHOP_MANAGER,
      themed(createElement(ConsoleShell, { children: "SCREEN-BODY" })),
      {
        membership: { branchId: "a", branchName: "Main" },
        branch: { branches: [main], branchMode: "bound", branch: main },
      },
    );
    expect(html.match(/>Main</g)).toHaveLength(2);
    expect(html).not.toContain("Switch branch");
  });

  it("renders for a platform admin with no business selected", () => {
    mockPathname = "/admin";
    const html = renderAsPlatformAdmin(
      themed(createElement(ConsoleShell, { children: "ADMIN-BODY" })),
    );
    expect(html).toContain("ADMIN-BODY");
    expect(html).toContain(">Platform<");
    expect(html).toContain("Platform Person");
  });
});
