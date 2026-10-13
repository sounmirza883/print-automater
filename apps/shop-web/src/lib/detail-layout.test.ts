import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = join(__dirname, "..", "components");

function count(file: string, needle: string): number {
  return readFileSync(join(COMPONENTS, file), "utf8").split(needle).length - 1;
}

/** [file, <Panel count, <StatGrid count] as they were before the two-column
 * layout. Rearranging a detail page must move its sections, never drop or
 * duplicate one; a deliberate change to a screen's sections updates its row. */
const SCREENS: ReadonlyArray<[string, number, number]> = [
  ["orders/order-detail.tsx", 4, 0],
  ["printers/printer-detail.tsx", 7, 1],
  ["inventory/inventory-item-screen.tsx", 3, 1],
  ["suppliers/supplier-detail.tsx", 2, 0],
  ["purchase-orders/po-detail.tsx", 3, 1],
  ["admin/business-detail.tsx", 5, 1],
  ["admin/user-detail.tsx", 3, 0],
];

describe("detail pages", () => {
  it.each(SCREENS)("%s keeps its %i panels and %i stat grids", (file, panels, statGrids) => {
    expect(count(file, "<Panel")).toBe(panels);
    expect(count(file, "<StatGrid")).toBe(statGrids);
  });

  it.each(SCREENS)("%s lays its sections out with DetailGrid", (file) => {
    expect(count(file, "<DetailGrid")).toBeGreaterThanOrEqual(1);
  });
});
