import { OrderStatus } from "@prisma/client";
import { GROUP_BY_STATUS, groupForOrder } from "./shop-orders.service.js";

const blocked = { status: "WAITING", blockedReason: "PRINTER_DISABLED" };
const plainWaiting = { status: "WAITING", blockedReason: null };
const queued = { status: "QUEUED", blockedReason: null };

describe("groupForOrder (19.12)", () => {
  it("with no blocked job, EVERY status keeps exactly its GROUP_BY_STATUS group (single-job orders unchanged)", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(groupForOrder(status, [])).toBe(GROUP_BY_STATUS[status]);
      expect(groupForOrder(status, [queued])).toBe(GROUP_BY_STATUS[status]);
      // A WAITING job WITHOUT a blockedReason is not "stranded".
      expect(groupForOrder(status, [plainWaiting])).toBe(GROUP_BY_STATUS[status]);
    }
  });

  it("an in-production order with a blocked WAITING job is needsAttention, whatever its non-terminal status", () => {
    for (const status of [
      OrderStatus.SHOP_ACCEPTED,
      OrderStatus.QUEUED_FOR_PRINT,
      OrderStatus.PREPARING,
      OrderStatus.ASSIGNED,
      OrderStatus.PRINTING,
    ]) {
      expect(groupForOrder(status, [blocked])).toBe("needsAttention");
      expect(groupForOrder(status, [queued, blocked])).toBe("needsAttention");
    }
  });

  it("terminal and hidden orders keep their groups even if a blocked job row exists", () => {
    for (const status of [
      OrderStatus.PRINTED,
      OrderStatus.READY_FOR_COLLECTION,
      OrderStatus.COMPLETED,
      OrderStatus.PRINT_FAILED,
      OrderStatus.SHOP_REJECTED,
      OrderStatus.CANCELLED,
      OrderStatus.DRAFT,
      OrderStatus.EXPIRED,
    ]) {
      expect(groupForOrder(status, [blocked])).toBe(GROUP_BY_STATUS[status]);
    }
  });

  it("orders already needing attention stay there", () => {
    expect(groupForOrder(OrderStatus.WAITING_FOR_SHOP, [blocked])).toBe("needsAttention");
    expect(groupForOrder(OrderStatus.PAUSED, [blocked])).toBe("needsAttention");
  });
});
