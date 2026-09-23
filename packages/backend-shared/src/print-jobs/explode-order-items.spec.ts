import type { PrintConfiguration } from "@print-automated/types";
import { explodeOrderItems, type OrderItemLike } from "./explode-order-items.js";

function config(): PrintConfiguration {
  return {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  };
}

describe("explodeOrderItems (18.3)", () => {
  it("turns N OrderItems into N PrintJobDrafts with the right orderItemId/printConfiguration/attempt: 1 on each", () => {
    const items: OrderItemLike[] = [
      { id: "item-1", documentId: "doc-1", printConfiguration: config(), required: true },
      {
        id: "item-2",
        documentId: "doc-2",
        printConfiguration: { ...config(), color: "COLOR" },
        required: true,
      },
      { id: "item-3", documentId: "doc-1", printConfiguration: config(), required: false },
    ];

    const drafts = explodeOrderItems(items);

    expect(drafts).toHaveLength(3);
    expect(drafts[0]).toEqual({
      orderItemId: "item-1",
      documentId: "doc-1",
      printConfiguration: config(),
      required: true,
      attempt: 1,
    });
    expect(drafts[1]).toMatchObject({
      orderItemId: "item-2",
      documentId: "doc-2",
      required: true,
      attempt: 1,
    });
    expect(drafts[1]?.printConfiguration.color).toBe("COLOR");
    expect(drafts[2]).toMatchObject({ orderItemId: "item-3", required: false, attempt: 1 });
  });

  it("an empty item list explodes to an empty draft list", () => {
    expect(explodeOrderItems([])).toEqual([]);
  });

  it("never fans out or merges -- exactly one draft per item, in the same order", () => {
    const items: OrderItemLike[] = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      documentId: "doc",
      printConfiguration: config(),
      required: true,
    }));
    const drafts = explodeOrderItems(items);
    expect(drafts.map((d) => d.orderItemId)).toEqual([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
  });
});
