import { randomUUID } from "node:crypto";
import {
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  PrintJobStatus,
  UserRole,
} from "@prisma/client";
import { OPERATOR_WORKLOAD_NOTICE } from "@print-automated/types";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

const DAY = 86_400_000;
const ago = (days: number, extraMs = 0): Date => new Date(Date.now() - days * DAY - extraMs);

/** 23.5 (PRD 72-74): the report endpoints. One isolated shop, exact assertions. */
describe("Reports (23.5, e2e)", () => {
  let fx: InventoryFixture;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const report = (name: string, query: Record<string, string> = {}, token = fx.token) =>
    http()
      .get(`/v1/shop/reports/${name}`)
      .query({ shopId: fx.shop.id, ...query })
      .set(as(token));

  let printerA: string;
  let printerB: string;
  let opsId: string;
  let extraOperatorId: string;
  let pricingRuleIds: string[] = [];

  async function order(
    status: OrderStatus,
    createdAt: Date,
    opts: { quantity?: number; config?: Record<string, unknown> } = {},
  ) {
    const o = await fx.makeOrder(1, opts.quantity ?? 1, status, opts.config);
    await fx.prisma.order.update({ where: { id: o.orderId }, data: { createdAt } });
    return o;
  }
  const pay = (orderId: string, amountMinor: number, status: PaymentStatus, at: Date) =>
    fx.prisma.payment.create({
      data: { orderId, provider: "test", amountMinor, currency: "PKR", status, updatedAt: at },
    });
  const job = (
    orderId: string,
    itemId: string | undefined,
    printerId: string | null,
    status: PrintJobStatus,
    extra: Record<string, unknown> = {},
  ) =>
    fx.prisma.printJob.create({
      data: {
        orderId,
        orderItemId: itemId,
        printerId,
        shopId: fx.shop.id,
        idempotencyToken: randomUUID(),
        status,
        operatorId: opsId,
        ...extra,
      },
    });

  beforeAll(async () => {
    fx = await createInventoryFixture("rep", { multiItemEnabled: false });
    opsId = fx.operator.user.id;
    const extra = await fx.prisma.user.create({
      data: {
        role: UserRole.OPERATOR,
        name: "aaa first operator",
        email: `rep-op2-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    extraOperatorId = extra.id;
    await fx.prisma.shopStaff.create({
      data: { shopId: fx.shop.id, userId: extra.id, role: UserRole.OPERATOR, status: "ACTIVE" },
    });

    printerA = (await fx.makePrinter("rep-A", { status: PrinterStatus.ONLINE })).printer.id;
    printerB = (
      await fx.makePrinter("rep-B", {
        status: PrinterStatus.ONLINE,
        pageLimit: 100,
        pageLimitEnabled: true,
      })
    ).printer.id;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    await fx.prisma.printerPageUsage.create({
      data: { printerId: printerB, periodStart: start, pagesUsed: 40 },
    });

    const o1 = await order(OrderStatus.COMPLETED, ago(3));
    const o2 = await order(OrderStatus.PRINTING, new Date(), {
      quantity: 2,
      config: {
        pages: { mode: "all" },
        copies: 2,
        paperSize: "A3",
        color: "COLOR",
        sides: "SINGLE",
        orientation: "PORTRAIT",
      },
    });
    const o3 = await order(OrderStatus.CANCELLED, ago(2));
    const o4 = await order(OrderStatus.PRINT_FAILED, new Date());
    const o5 = await order(OrderStatus.COMPLETED, ago(60)); // outside the default 30 days
    await fx.makeOrder(1, 1, OrderStatus.DRAFT); // hidden from the shop

    await pay(o1.orderId, 3000, PaymentStatus.PAID, ago(3));
    await pay(o2.orderId, 1000, PaymentStatus.PAID, new Date());
    await pay(o3.orderId, 2000, PaymentStatus.REFUNDED, ago(2));
    await pay(o5.orderId, 9999, PaymentStatus.PAID, ago(60));

    await job(o1.orderId, o1.itemIds[0], printerA, PrintJobStatus.PRINTED, {
      claimedAt: ago(3, 60_000),
      updatedAt: ago(3),
    });
    await job(o2.orderId, o2.itemIds[0], printerA, PrintJobStatus.PRINTED, {
      claimedAt: ago(0, 120_000),
      updatedAt: new Date(),
    });
    await job(o4.orderId, o4.itemIds[0], printerB, PrintJobStatus.FAILED);
    await job(o2.orderId, undefined, printerA, PrintJobStatus.QUEUED);

    // paper consumption
    const item = await fx.prisma.inventoryItem.create({
      data: {
        shopId: fx.shop.id,
        name: "A4 80gsm",
        paperSize: "A4",
        paperType: "PLAIN",
        quantity: 70,
      },
    });
    const mv = (delta: number, type: "CONSUMPTION" | "PURCHASE", at: Date, after: number) =>
      fx.prisma.inventoryMovement.create({
        data: {
          shopId: fx.shop.id,
          inventoryItemId: item.id,
          type,
          quantityDelta: delta,
          quantityAfter: after,
          createdAt: at,
        },
      });
    await mv(-20, "CONSUMPTION", new Date(), 80);
    await mv(-10, "CONSUMPTION", ago(3), 100);
    await mv(100, "PURCHASE", ago(4), 110);
    await mv(-99, "CONSUMPTION", ago(90), 0); // outside the range

    // supplier purchases
    const supplier = await fx.prisma.supplier.create({
      data: { shopId: fx.shop.id, name: "Paper Co" },
    });
    for (const [status, cost] of [
      ["DRAFT", 500],
      ["RECEIVED", 1500],
      ["CANCELLED", 700],
    ] as const) {
      await fx.prisma.purchaseOrder.create({
        data: { shopId: fx.shop.id, supplierId: supplier.id, status, totalCostMinor: cost },
      });
    }
  });

  afterAll(async () => {
    if (fx) {
      await fx.prisma.printerPageUsage.deleteMany({ where: { printerId: printerB } });
      await fx.prisma.pricingRule.deleteMany({ where: { id: { in: pricingRuleIds } } });
      await fx.cleanup();
      await fx.prisma.user.deleteMany({ where: { id: extraOperatorId } });
    }
  });

  it("orders: counts by outcome per day with every bucket present and snapshot value", async () => {
    const res = await report("orders");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ report: "orders", groupBy: "day", currency: "PKR" });
    expect(res.body.rows).toHaveLength(31);
    expect(res.body.totals).toEqual({
      total: 4,
      completed: 1,
      cancelled: 1,
      rejected: 0,
      printFailed: 1,
      open: 1,
      valueMinor: 12000,
    });
    const sum = res.body.rows.reduce((a: number, r: { total: number }) => a + r.total, 0);
    expect(sum).toBe(4);
    const zero = res.body.rows.find((r: { total: number }) => r.total === 0);
    expect(zero).toMatchObject({ completed: 0, valueMinor: 0 });
    expect(res.body.rows.map((r: { bucket: string }) => r.bucket)).toEqual(
      [...res.body.rows.map((r: { bucket: string }) => r.bucket)].sort(),
    );
    expect(res.body.truncated).toBe(false);
  });

  it("orders: week and month grouping partition the same orders", async () => {
    for (const groupBy of ["week", "month"]) {
      const res = await report("orders", { groupBy });
      expect(res.status).toBe(200);
      expect(res.body.groupBy).toBe(groupBy);
      expect(res.body.totals.total).toBe(4);
      const sum = res.body.rows.reduce((a: number, r: { total: number }) => a + r.total, 0);
      expect(sum).toBe(4);
    }
  });

  it("revenue: only confirmed payments in range; refunds shown separately; a later price change alters nothing", async () => {
    const before = await report("revenue");
    expect(before.status).toBe(200);
    expect(before.body.totals).toEqual({
      revenueMinor: 4000,
      paidOrders: 2,
      refundedMinor: 2000,
      refundedOrders: 1,
    });
    // Reprice the shop massively: past revenue comes from the paid amounts, never a live rule.
    for (const version of [1, 2]) {
      const rule = await fx.prisma.pricingRule.create({
        data: {
          shopId: fx.shop.id,
          version,
          currency: "PKR",
          pricePerPageMinor: 999_999,
          colorSurchargePerPageMinor: 999_999,
          otherCharges: {},
          minimumChargeMinor: 999_999,
        },
      });
      pricingRuleIds = [...pricingRuleIds, rule.id];
    }
    const after = await report("revenue");
    expect(after.body.totals).toEqual(before.body.totals);
    expect(after.body.rows).toEqual(before.body.rows);
    // an explicit wider range picks up the old payment
    const wide = await report("revenue", { from: ago(90).toISOString() });
    expect(wide.body.totals.revenueMinor).toBe(4000 + 9999);
  });

  it("printing volume: pages x copies of printed jobs, split by colour and paper size", async () => {
    const res = await report("printing-volume");
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      jobsPrinted: 2,
      pagesPrinted: 15,
      colorPages: 10,
      bwPages: 5,
      byPaperSize: [
        { paperSize: "A3", pages: 10 },
        { paperSize: "A4", pages: 5 },
      ],
    });
    expect(res.body.rows).toHaveLength(31);
  });

  it("printer usage and failures: per printer counts, mean duration, current page allowance", async () => {
    const res = await report("printers");
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBeNull();
    const a = res.body.rows.find((r: { name: string }) => r.name === "rep-A");
    const b = res.body.rows.find((r: { name: string }) => r.name === "rep-B");
    expect(a).toMatchObject({
      jobsCompleted: 2,
      jobsFailed: 0,
      pagesPrinted: 15,
      avgJobDurationSeconds: 90,
      downtimeSeconds: null,
      pageLimit: { enabled: false, limit: null, remaining: null },
    });
    expect(b).toMatchObject({
      jobsCompleted: 0,
      jobsFailed: 1,
      pagesPrinted: 0,
      avgJobDurationSeconds: null,
      pageLimit: { enabled: true, limit: 100, pagesUsedInPeriod: 40, remaining: 60 },
    });
    expect(res.body.totals).toEqual({
      jobsCompleted: 2,
      jobsFailed: 1,
      jobsUnknown: 0,
      pagesPrinted: 15,
    });
  });

  it("operator workload (§74): descriptive counts, alphabetical, no ranking or evaluation language", async () => {
    const res = await report("operator-workload");
    expect(res.status).toBe(200);
    const names = res.body.rows.map((r: { name: string }) => r.name);
    expect(names).toEqual([...names].sort((x: string, y: string) => x.localeCompare(y)));
    expect(names[0]).toBe("aaa first operator");
    const mine = res.body.rows.find((r: { operatorId: string }) => r.operatorId === opsId);
    expect(mine).toMatchObject({
      jobsAssigned: 4,
      jobsCompleted: 2,
      jobsFailed: 1,
      avgCompletionSeconds: 90,
      currentAssignedJobs: 1,
    });
    const idle = res.body.rows.find(
      (r: { operatorId: string }) => r.operatorId === extraOperatorId,
    );
    expect(idle).toMatchObject({ jobsAssigned: 0, jobsCompleted: 0, avgCompletionSeconds: null });
    expect(res.body.totals.notice).toBe(OPERATOR_WORKLOAD_NOTICE);
    // field names and notice never use ranking / scoring / productivity language
    const text = JSON.stringify(res.body, (_key, value: unknown) => value);
    const keys = [...text.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]).join(" ");
    expect(`${keys} ${res.body.totals.notice}`).not.toMatch(
      /rank|score|productiv|perform|best|worst|leaderboard|efficien|top\b|grade/i,
    );
  });

  it("paper consumption: sheets drawn down by CONSUMPTION movements in range, per item and per bucket", async () => {
    const res = await report("paper-consumption");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      expect.objectContaining({
        name: "A4 80gsm",
        paperSize: "A4",
        paperType: "PLAIN",
        sheetsConsumed: 30,
        movements: 2,
      }),
    ]);
    expect(res.body.totals.sheetsConsumed).toBe(30);
    const nonZero = res.body.totals.series.filter((s: { sheets: number }) => s.sheets > 0);
    expect(nonZero.map((s: { sheets: number }) => s.sheets).sort()).toEqual([10, 20]);
    expect(res.body.totals.series).toHaveLength(31);
  });

  it("supplier purchases: cost of non-cancelled purchase orders per supplier", async () => {
    const res = await report("supplier-purchases");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      expect.objectContaining({
        name: "Paper Co",
        purchaseOrders: 3,
        received: 1,
        cancelled: 1,
        totalCostMinor: 2000,
      }),
    ]);
    expect(res.body.totals).toMatchObject({
      purchaseOrders: 3,
      received: 1,
      cancelled: 1,
      totalCostMinor: 2000,
    });
  });

  it("csv export: text/csv of the rows, attachment filename, formula-safe", async () => {
    const res = await report("revenue", { format: "csv" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="revenue-/);
    const lines = (res.text as string).trim().split("\r\n");
    expect(lines[0]).toBe("bucket,revenueMinor,paidOrders,refundedMinor,refundedOrders");
    expect(lines).toHaveLength(32);
    const printers = await report("printers", { format: "csv" });
    expect((printers.text as string).split("\r\n")[0]).toContain("pageLimit.remaining");
  });

  it("the range is bounded and validated", async () => {
    expect((await report("orders", { from: ago(400).toISOString() })).status).toBe(400);
    expect(
      (await report("orders", { from: new Date().toISOString(), to: ago(1).toISOString() })).status,
    ).toBe(400);
    expect((await report("orders", { groupBy: "hour" })).status).toBe(400);
    expect((await report("orders", { format: "xml" })).status).toBe(400);
    expect((await report("nonsense")).status).toBe(404);
  });

  it("permissions and isolation: manager 200; operator, counter 403; other business 403; anonymous 401; another shop reads only its own data", async () => {
    const names = [
      "orders",
      "revenue",
      "printing-volume",
      "printers",
      "operator-workload",
      "paper-consumption",
      "supplier-purchases",
    ];
    for (const name of names) {
      expect((await report(name, {}, fx.manager.token)).status).toBe(200);
      expect((await report(name, {}, fx.operator.token)).status).toBe(403);
      expect((await report(name, {}, fx.counter.token)).status).toBe(403);
      expect((await report(name, {}, fx.ownerB.token)).status).toBe(403);
      expect(
        (await http().get(`/v1/shop/reports/${name}`).query({ shopId: fx.shop.id })).status,
      ).toBe(401);
      const own = await http()
        .get(`/v1/shop/reports/${name}`)
        .query({ shopId: fx.shopB.id })
        .set(as(fx.ownerB.token));
      expect(own.status).toBe(200);
      const serialised = JSON.stringify(own.body);
      expect(serialised).not.toContain("rep-A");
      expect(serialised).not.toContain("Paper Co");
      expect(serialised).not.toContain("A4 80gsm");
    }
    const ownRevenue = await http()
      .get("/v1/shop/reports/revenue")
      .query({ shopId: fx.shopB.id })
      .set(as(fx.ownerB.token));
    expect(ownRevenue.body.totals.revenueMinor).toBe(0);
  });
});
