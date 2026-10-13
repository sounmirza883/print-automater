/* eslint-disable react/no-children-prop -- a .ts file has no JSX, and the kit's components require `children` in their props type, so createElement's rest-argument form would not type-check. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Menu, MenuItem } from "@/components/menu";
import { Segmented } from "@/components/segmented";
import { Tabs } from "@/components/tabs";
import {
  Avatar,
  BackLink,
  Button,
  Cell,
  DataTable,
  DetailGrid,
  Notice,
  Panel,
  Pill,
  Row,
} from "@/components/ui";

describe("Button", () => {
  it("draws the primary action in inverse ink, which flips with the theme", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "primary", children: "Save" }),
    );
    expect(html).toContain("bg-inv");
    expect(html).toContain("text-inv-ink");
    expect(html).not.toContain("text-white");
    expect(html).not.toContain("bg-accent");
  });

  it("keeps white text only on the danger fill", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "danger", children: "Delete" }),
    );
    expect(html).toContain("bg-danger");
    expect(html).toContain("text-white");
  });

  it("has a 44px size that replaces, not competes with, the default minimum height", () => {
    const html = renderToStaticMarkup(createElement(Button, { size: "lg", children: "Continue" }));
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("min-h-9");
  });

  it("stays a plain button by default and submits only when asked", () => {
    expect(renderToStaticMarkup(createElement(Button, { children: "Go" }))).toContain(
      'type="button"',
    );
    expect(
      renderToStaticMarkup(createElement(Button, { type: "submit", children: "Go" })),
    ).toContain('type="submit"');
  });
});

describe("Pill", () => {
  it("always carries its text, not colour alone", () => {
    const html = renderToStaticMarkup(createElement(Pill, { tone: "danger", children: "Blocked" }));
    expect(html).toContain("Blocked");
    expect(html).toContain("text-danger-fg");
  });
});

describe("Segmented", () => {
  it("marks exactly the chosen option as pressed", () => {
    const html = renderToStaticMarkup(
      createElement(Segmented<"a" | "b">, {
        value: "b",
        onChange: () => undefined,
        ariaLabel: "Pick",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>B</);
  });
});

describe("Tabs", () => {
  const items = [
    { id: "all", label: "All", count: 41 },
    { id: "attention", label: "Needs attention", count: 3, emphasis: true },
  ];

  it("marks the active button tab as current (not as a page) and shows counts", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { items, activeId: "attention", ariaLabel: "Order groups" }),
    );
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain(">41<");
    expect(html).toContain(">3<");
  });

  it("marks the active link tab as the current page", () => {
    const linked = items.map((item) => ({ ...item, href: `/orders/${item.id}` }));
    const html = renderToStaticMarkup(
      createElement(Tabs, { items: linked, activeId: "attention", ariaLabel: "Order groups" }),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-current="true"');
  });

  it("keeps the underline inside a wrapper so the scroll container does not clip it", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { items, activeId: "all", ariaLabel: "Order groups" }),
    );
    expect(html).toMatch(/<nav[^>]*class="overflow-x-auto /);
    expect(html).toMatch(/<div class="flex min-w-max gap-1 border-b border-line">/);
  });

  it("marks nothing when no tab is active", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { items, activeId: null, ariaLabel: "Order groups" }),
    );
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('aria-current="true"');
  });
});

describe("Menu", () => {
  // Static markup is all this node-environment jest can render, so only the closed
  // state is covered here; open/close/focus behaviour is not exercised by jest.
  it("renders a closed popover trigger that names the dialog it controls", () => {
    const html = renderToStaticMarkup(
      createElement(Menu, {
        label: "Account",
        trigger: (props) => createElement("button", { type: "button", ...props }, "Open"),
        children: () => createElement("p", null, "Inside"),
      }),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("aria-controls=");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Inside");
  });
});

describe("MenuItem", () => {
  it("is a plain button without href", () => {
    const html = renderToStaticMarkup(createElement(MenuItem, { children: "Sign out" }));
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain('role="menuitem"');
  });

  it("is a link with href", () => {
    const html = renderToStaticMarkup(
      createElement(MenuItem, { href: "/x", children: "Settings" }),
    );
    expect(html).toContain("<a");
    expect(html).toContain('href="/x"');
    expect(html).not.toContain('role="menuitem"');
  });
});

describe("Avatar", () => {
  it("shows initials and hides them from assistive tech (the name is beside it)", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { name: "Ayesha Khan" }));
    expect(html).toContain(">AK<");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("Notice", () => {
  it("adds no role of its own, so a quiet message is never announced by accident", () => {
    const html = renderToStaticMarkup(
      createElement(Notice, { tone: "danger", children: "Could not save." }),
    );
    expect(html).toContain("Could not save.");
    expect(html).not.toContain("role=");
    expect(html).toContain("bg-danger-soft");
  });

  it("passes through the role it is given", () => {
    for (const role of ["alert", "status", "note"] as const) {
      const html = renderToStaticMarkup(createElement(Notice, { role, children: "x" }));
      expect(html).toContain(`role="${role}"`);
    }
  });

  it("keeps the caller's layout classes", () => {
    const html = renderToStaticMarkup(
      createElement(Notice, { tone: "good", className: "mb-3 flex", children: "x" }),
    );
    expect(html).toContain("mb-3 flex");
    expect(html).toContain("bg-good-soft");
  });
});

describe("BackLink", () => {
  it("is a link to the parent screen, named by its text", () => {
    const html = renderToStaticMarkup(
      createElement(BackLink, { href: "/orders", children: "Orders" }),
    );
    expect(html).toContain('href="/orders"');
    expect(html).toContain("Orders");
    expect(html).not.toContain("←");
  });
});

describe("DetailGrid", () => {
  it("renders the main column before the reference column, so a phone reads main first", () => {
    const html = renderToStaticMarkup(
      createElement(DetailGrid, { main: "MAIN-PART", aside: "ASIDE-PART" }),
    );
    expect(html.indexOf("MAIN-PART")).toBeGreaterThan(-1);
    expect(html.indexOf("MAIN-PART")).toBeLessThan(html.indexOf("ASIDE-PART"));
  });

  it("gives the main column the full width when the reference column renders nothing", () => {
    const html = renderToStaticMarkup(
      createElement(DetailGrid, { main: "MAIN-PART", aside: null }),
    );
    // An aside with nothing inside it is hidden, and the outer grid drops to one column.
    expect(html).toContain('empty:hidden"></div>');
    expect(html).toContain("xl:has-[&gt;div:last-child:empty]:grid-cols-1");
  });

  it("can shrink inside a parent grid and starts its two columns at xl, not lg", () => {
    const html = renderToStaticMarkup(
      createElement(DetailGrid, { main: "MAIN-PART", aside: "ASIDE-PART" }),
    );
    const rootClass = /^<div class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(rootClass.split(" ")).toContain("min-w-0");
    expect(rootClass).toContain("xl:grid-cols-");
    expect(rootClass).not.toContain("lg:grid-cols");
  });
});

describe("DataTable", () => {
  const rows = createElement(Row, {
    children: [
      createElement(Cell, { key: "a", children: "Ayesha Khan" }),
      createElement(Cell, { key: "b", label: "Phone", children: "0300 0000000" }),
    ],
  });

  it("changes nothing for a table that does not opt in", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, { caption: "People", head: ["Name", "Phone"], children: null }),
    );
    expect(html).toContain("min-w-[32rem]");
    expect(html).not.toContain("stack-sm");
    expect(html).not.toContain('role="table"');
  });

  it("keeps table roles on an opted-in table, because its phone layout stops being display:table", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        caption: "People",
        head: ["Name", "Phone"],
        stackOnPhone: true,
        children: rows,
      }),
    );
    expect(html).toContain("stack-sm");
    expect(html).toContain('role="table"');
    expect(html.match(/role="rowgroup"/g)).toHaveLength(2);
    expect(html.match(/role="columnheader"/g)).toHaveLength(2);
    expect(html.match(/role="row"/g)).toHaveLength(2);
    expect(html.match(/role="cell"/g)).toHaveLength(2);
  });

  it("labels a value cell for its phone card and leaves the title cell unlabelled", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        caption: "People",
        head: ["Name", "Phone"],
        stackOnPhone: true,
        children: rows,
      }),
    );
    expect(html).toContain('data-label="Phone"');
    expect(html.match(/data-label=/g)).toHaveLength(1);
  });
});

describe("Panel", () => {
  it("drops its own box on a phone only when asked, so phone cards are not boxed twice", () => {
    const plain = renderToStaticMarkup(createElement(Panel, { children: "x" }));
    const flush = renderToStaticMarkup(createElement(Panel, { flushOnPhone: true, children: "x" }));
    expect(plain).not.toContain("max-sm:border-0");
    expect(flush).toContain("max-sm:border-0");
  });
});
