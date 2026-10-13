import { movePaletteIndex, paletteEntries } from "./command-palette";
import type { NavItem } from "./nav";

function item(id: string, label: string, blurb: string): NavItem {
  return { id, label, href: `/${id}`, scope: "business", group: "production", anyOf: [], blurb };
}

const ITEMS: NavItem[] = [
  item("orders", "Orders & queue", "The production queue."),
  item("printers", "Printers", "Register printers."),
  item("purchase-orders", "Purchase orders", "Restock orders and receiving."),
  item("reports", "Reports", "Revenue and printing volume."),
];

function ids(query: string, canSearchOrders = false): string[] {
  return paletteEntries(query, ITEMS, canSearchOrders).map((entry) => entry.id);
}

describe("paletteEntries", () => {
  it("lists every screen, in navigation order, before anything is typed", () => {
    expect(ids("")).toEqual(["orders", "printers", "purchase-orders", "reports"]);
    expect(ids("   ", true)).toEqual(["orders", "printers", "purchase-orders", "reports"]);
  });

  it("carries the screen's link and its one-line description", () => {
    expect(paletteEntries("", ITEMS, false)[1]).toEqual({
      id: "printers",
      label: "Printers",
      href: "/printers",
      hint: "Register printers.",
    });
  });

  it("puts screens whose name starts with the text first, then other matches", () => {
    expect(ids("p")).toEqual(["printers", "purchase-orders", "orders", "reports"]);
  });

  it("matches without regard to case, in the name or the description", () => {
    expect(ids("ORD")).toEqual(["orders", "purchase-orders"]);
    expect(ids("revenue")).toEqual(["reports"]);
  });

  it("offers an orders search last, so a typed screen name still lands on the screen", () => {
    const entries = paletteEntries("  ord ", ITEMS, true);
    expect(entries.map((entry) => entry.id)).toEqual([
      "orders",
      "purchase-orders",
      "search-orders",
    ]);
    expect(entries[2]).toEqual({
      id: "search-orders",
      label: 'Search orders for "ord"',
      href: "/orders?q=ord",
      hint: "Order number, customer or document",
    });
  });

  it("offers only the orders search when no screen matches", () => {
    expect(ids("PA-10482", true)).toEqual(["search-orders"]);
  });

  it("offers nothing when no screen matches and the role cannot search orders", () => {
    expect(ids("PA-10482", false)).toEqual([]);
  });

  it("encodes the typed text into the link", () => {
    const entries = paletteEntries("a&b=c #1", ITEMS, true);
    expect(entries[entries.length - 1]?.href).toBe("/orders?q=a%26b%3Dc%20%231");
  });

  it("caps the search text at the 100 characters the orders search accepts", () => {
    const entries = paletteEntries("x".repeat(150), ITEMS, true);
    expect(entries[entries.length - 1]?.href).toBe(`/orders?q=${"x".repeat(100)}`);
  });

  it("never cuts an emoji in half at the 100-character cap", () => {
    const entries = paletteEntries(`${"x".repeat(99)}😀😀`, ITEMS, true);
    expect(entries[entries.length - 1]?.href).toBe(
      `/orders?q=${"x".repeat(99)}${encodeURIComponent("😀")}`,
    );
  });

  it("does not leave a trailing space when the cap falls on one", () => {
    const entries = paletteEntries(`${"x".repeat(99)} tail`, ITEMS, true);
    expect(entries[entries.length - 1]?.href).toBe(`/orders?q=${"x".repeat(99)}`);
  });
});

describe("movePaletteIndex", () => {
  it("steps forward and back", () => {
    expect(movePaletteIndex(0, 3, 1)).toBe(1);
    expect(movePaletteIndex(2, 3, -1)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(movePaletteIndex(2, 3, 1)).toBe(0);
    expect(movePaletteIndex(0, 3, -1)).toBe(2);
  });

  it("stays put with a single option and returns 0 with none", () => {
    expect(movePaletteIndex(0, 1, 1)).toBe(0);
    expect(movePaletteIndex(0, 1, -1)).toBe(0);
    expect(movePaletteIndex(5, 0, 1)).toBe(0);
  });
});
