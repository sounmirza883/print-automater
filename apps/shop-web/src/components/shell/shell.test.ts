/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required, so children go in the props object. Same as ui.test.ts. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserRole, type Permission } from "@print-automated/types";
import { ConsoleShell } from "@/components/console-shell";
import { SessionContext } from "@/components/session-provider";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { BusinessSwitcher } from "@/components/shell/business-switcher";
import { NavList } from "@/components/shell/nav-list";
import { renderAs } from "@/components/test-session";
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
