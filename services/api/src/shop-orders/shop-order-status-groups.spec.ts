import { OrderStatus } from "@prisma/client";
import { GROUP_BY_STATUS, SHOP_VISIBLE_STATUSES } from "./shop-orders.service";

describe("shop order status grouping (18.14)", () => {
  it("places every OrderStatus explicitly (a group or 'hidden')", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(Object.prototype.hasOwnProperty.call(GROUP_BY_STATUS, status)).toBe(true);
    }
  });

  it("makes the four 18.2 statuses visible in the right groups", () => {
    expect(GROUP_BY_STATUS[OrderStatus.PREPARING]).toBe("printing");
    expect(GROUP_BY_STATUS[OrderStatus.ASSIGNED]).toBe("printing");
    expect(GROUP_BY_STATUS[OrderStatus.PAUSED]).toBe("needsAttention");
    expect(GROUP_BY_STATUS[OrderStatus.QUALITY_CHECK]).toBe("needsAttention");
  });

  it("derives the visible list from the non-hidden entries", () => {
    const expected = Object.values(OrderStatus).filter((s) => GROUP_BY_STATUS[s] !== "hidden");
    expect([...SHOP_VISIBLE_STATUSES].sort()).toEqual([...expected].sort());
    expect(SHOP_VISIBLE_STATUSES).not.toContain(OrderStatus.DRAFT);
  });
});
