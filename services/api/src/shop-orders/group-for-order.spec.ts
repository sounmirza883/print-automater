import { OrderCreationSource, OrderStatus } from "@prisma/client";
import {
  GROUP_BY_STATUS,
  QR_AWAITING_PAYMENT,
  groupForOrder,
  shopVisibleWhere,
  whereInGroup,
} from "./shop-orders.service.js";

const blocked = { status: "WAITING", blockedReason: "PRINTER_DISABLED" };
const plainWaiting = { status: "WAITING", blockedReason: null };
const queued = { status: "QUEUED", blockedReason: null };

const WEB = OrderCreationSource.CUSTOMER_WEB;
const COUNTER = OrderCreationSource.COUNTER;
const QR = OrderCreationSource.QR;

describe("groupForOrder (19.12)", () => {
  it("with no blocked job, EVERY status keeps exactly its GROUP_BY_STATUS group (single-job orders unchanged)", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(groupForOrder(status, [], WEB)).toBe(GROUP_BY_STATUS[status]);
      expect(groupForOrder(status, [queued], WEB)).toBe(GROUP_BY_STATUS[status]);
      // A WAITING job WITHOUT a blockedReason is not "stranded".
      expect(groupForOrder(status, [plainWaiting], WEB)).toBe(GROUP_BY_STATUS[status]);
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
      expect(groupForOrder(status, [blocked], WEB)).toBe("needsAttention");
      expect(groupForOrder(status, [queued, blocked], WEB)).toBe("needsAttention");
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
      expect(groupForOrder(status, [blocked], WEB)).toBe(GROUP_BY_STATUS[status]);
    }
  });

  it("orders already needing attention stay there", () => {
    expect(groupForOrder(OrderStatus.WAITING_FOR_SHOP, [blocked], WEB)).toBe("needsAttention");
    expect(groupForOrder(OrderStatus.PAUSED, [blocked], WEB)).toBe("needsAttention");
  });
});

describe("groupForOrder: 24.1 QR orders awaiting payment", () => {
  it("a QR order in UPLOADED is needsAttention -- staff must see it to take payment", () => {
    expect(groupForOrder(OrderStatus.UPLOADED, [], QR)).toBe("needsAttention");
  });

  it("every other UPLOADED order stays exactly as hidden as before (web mid-checkout, counter before its payment call)", () => {
    expect(groupForOrder(OrderStatus.UPLOADED, [], WEB)).toBe("hidden");
    expect(groupForOrder(OrderStatus.UPLOADED, [], COUNTER)).toBe("hidden");
  });

  it("QR changes nothing for any status other than UPLOADED", () => {
    for (const status of Object.values(OrderStatus)) {
      if (status === OrderStatus.UPLOADED) continue;
      expect(groupForOrder(status, [], QR)).toBe(GROUP_BY_STATUS[status]);
      expect(groupForOrder(status, [blocked], QR)).toBe(groupForOrder(status, [blocked], WEB));
    }
  });
});

describe("the SQL forms agree with groupForOrder (24.1)", () => {
  it("whereInGroup('needsAttention') includes QR orders awaiting payment", () => {
    expect(whereInGroup("needsAttention").OR).toContainEqual(QR_AWAITING_PAYMENT);
    expect(QR_AWAITING_PAYMENT).toEqual({
      orderStatus: OrderStatus.UPLOADED,
      creationSource: OrderCreationSource.QR,
    });
  });

  it("no other group admits them", () => {
    for (const group of ["printing", "ready", "completed", "failed"] as const) {
      expect(JSON.stringify(whereInGroup(group))).not.toContain(OrderCreationSource.QR);
    }
  });

  it("shopVisibleWhere admits them with no status filter or a status=UPLOADED filter, and never otherwise", () => {
    expect(shopVisibleWhere().OR).toContainEqual(QR_AWAITING_PAYMENT);
    expect(shopVisibleWhere(OrderStatus.UPLOADED).OR).toEqual([
      { orderStatus: { in: [] } },
      QR_AWAITING_PAYMENT,
    ]);
    expect(shopVisibleWhere(OrderStatus.WAITING_FOR_SHOP).OR).toEqual([
      { orderStatus: { in: [OrderStatus.WAITING_FOR_SHOP] } },
    ]);
    // A status the shop never sees stays invisible (empty set, no QR clause).
    expect(shopVisibleWhere(OrderStatus.DRAFT).OR).toEqual([{ orderStatus: { in: [] } }]);
  });
});
