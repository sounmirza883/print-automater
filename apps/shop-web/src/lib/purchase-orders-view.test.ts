import {
  availablePoActions,
  checkPoLines,
  checkReceipt,
  orderTotalMinor,
  type LineForm,
} from "./purchase-orders-view";

const line = (over: Partial<LineForm> = {}): LineForm => ({
  key: "k",
  inventoryItemId: "it-1",
  quantity: "500",
  unitCost: "",
  ...over,
});

describe("availablePoActions", () => {
  it("offers place only on a draft and receive only once ordered", () => {
    expect(availablePoActions("DRAFT")).toMatchObject({
      place: true,
      receive: false,
      cancel: true,
    });
    expect(availablePoActions("ORDERED")).toMatchObject({
      place: false,
      receive: true,
      cancel: true,
    });
  });

  it("closes received and cancelled orders (payment can still be recorded on received)", () => {
    expect(availablePoActions("RECEIVED")).toMatchObject({
      place: false,
      receive: false,
      cancel: false,
      setPayment: true,
    });
    expect(availablePoActions("CANCELLED")).toMatchObject({ cancel: false, setPayment: false });
  });
});

describe("checkPoLines", () => {
  it("builds lines with minor-unit costs and leaves a blank cost to the item's own", () => {
    expect(
      checkPoLines([line({ unitCost: "1.25" }), line({ inventoryItemId: "it-2" })], "PKR"),
    ).toEqual({
      ok: true,
      lines: [
        { inventoryItemId: "it-1", quantity: 500, unitCostMinor: 125 },
        { inventoryItemId: "it-2", quantity: 500, unitCostMinor: undefined },
      ],
    });
  });

  it.each([
    [[], /at least one line/],
    [[line({ inventoryItemId: "" })], /choose an item/],
    [[line(), line()], /once per order/],
    [[line({ quantity: "0" })], /whole quantity/],
    [[line({ quantity: "1.5" })], /whole quantity/],
    [[line({ unitCost: "abc" })], /unit cost/],
  ])("explains %#", (lines, pattern) => {
    const result = checkPoLines(lines as LineForm[], "PKR");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  });
});

describe("checkReceipt", () => {
  const po = {
    lines: [
      {
        id: "l1",
        itemName: "A4",
        inventoryItemId: "i",
        quantityOrdered: 500,
        unitCostMinor: 1,
        quantityReceived: null,
      },
      {
        id: "l2",
        itemName: "A3",
        inventoryItemId: "j",
        quantityOrdered: 100,
        unitCostMinor: 1,
        quantityReceived: null,
      },
    ],
  };

  it("defaults to the ordered quantity and accepts partial and zero receipts", () => {
    expect(checkReceipt(po, {})).toEqual({
      ok: true,
      lines: [
        { lineId: "l1", quantityReceived: 500 },
        { lineId: "l2", quantityReceived: 100 },
      ],
    });
    expect(checkReceipt(po, { l1: "450", l2: "0" })).toEqual({
      ok: true,
      lines: [
        { lineId: "l1", quantityReceived: 450 },
        { lineId: "l2", quantityReceived: 0 },
      ],
    });
  });

  it("names the line with a bad number", () => {
    const result = checkReceipt(po, { l2: "-3" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^A3:/);
  });
});

describe("orderTotalMinor", () => {
  it("sums quantity x unit cost in minor units", () => {
    expect(
      orderTotalMinor([
        { quantity: 500, unitCostMinor: 120 },
        { quantity: 2, unitCostMinor: 5 },
      ]),
    ).toBe(60010);
  });
});
