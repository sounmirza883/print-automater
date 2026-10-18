import { randomUUID } from "node:crypto";
import {
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  PrintJobStatus,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

/** 23.2 (PRD 39-42): the dashboard aggregate endpoints. Everything is seeded in an
 * isolated shop; assertions are exact because no other suite writes to it. */
describe("Dashboards (23.2, e2e)", () => {
  let fx: InventoryFixture;
  let adminToken: string;
  let adminId: string;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const created: { paymentOrderIds: string[] } = { paymentOrderIds: [] };

  async function pay(orderId: string, amountMinor: number, status: PaymentStatus) {
    created.paymentOrderIds.push(orderId);
    return fx.prisma.payment.create({
      data: { orderId, provider: "test", amountMinor, currency: "PKR", status },
    });
  }
  async function refund(orderId: string, paymentId: string, amountMinor: number) {
    return fx.prisma.refund.create({
      data: {
        orderId,
        paymentId,
        amountMinor,
        currency: "PKR",
        status: PaymentStatus.REFUNDED,
        reason: "test",
      },
    });
  }
  async function job(
    orderId: string,
    printerId: string | null,
    status: PrintJobStatus,
    extra: Record<string, unknown> = {},
    itemId?: string,
  ) {
    return fx.prisma.printJob.create({
      data: {
        orderId,
        printerId,
        shopId: fx.shop.id,
        branchId: await branchIdOf(fx.prisma, fx.shop.id),
        idempotencyToken: randomUUID(),
        status,
        orderItemId: itemId,
        ...extra,
      },
    });
  }

  let printerA: string;
  let printerB: string;
  let ops: { id: string };
  let shopBOrderId: string;

  beforeAll(async () => {
    fx = await createInventoryFixture("dash", { multiItemEnabled: false });
    ops = fx.operator.user;
    const admin = await fx.prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "dash admin",
        email: `dash-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    adminId = admin.id;
    adminToken = fx.tokens.issueAccessToken(admin);

    const pA = await fx.makePrinter("dash-A", { status: PrinterStatus.ONLINE });
    const pB = await fx.makePrinter("dash-B", {
      status: PrinterStatus.OFFLINE,
      pageLimit: 100,
      pageLimitEnabled: true,
    });
    printerA = pA.printer.id;
    printerB = pB.printer.id;

    // 3 paid orders: two live, one completed; one refunded; one unpaid draft (hidden).
    const o1 = await fx.makeOrder(1, 2, OrderStatus.PRINTING); // 2 copies x 5 pages
    const o2 = await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP);
    const o3 = await fx.makeOrder(1, 1, OrderStatus.COMPLETED);
    const o4 = await fx.makeOrder(1, 1, OrderStatus.CANCELLED);
    const o5 = await fx.makeOrder(1, 1, OrderStatus.PRINT_FAILED);
    await fx.makeOrder(1, 1, OrderStatus.DRAFT);
    await fx.prisma.order.update({ where: { id: o3.orderId }, data: { completedAt: new Date() } });
    await pay(o1.orderId, 3000, PaymentStatus.PAID);
    await pay(o2.orderId, 1000, PaymentStatus.PAID);
    await pay(o3.orderId, 500, PaymentStatus.PAID);
    const refunded = await pay(o4.orderId, 7777, PaymentStatus.REFUNDED);
    await refund(o4.orderId, refunded.id, 7000); // the refund's own amount, not the payment's

    await job(o1.orderId, printerA, PrintJobStatus.PRINTING, { operatorId: ops.id }, o1.itemIds[0]);
    await job(
      o2.orderId,
      null,
      PrintJobStatus.WAITING,
      { blockedReason: "NO_PAPER" },
      o2.itemIds[0],
    );
    await job(o3.orderId, printerA, PrintJobStatus.PRINTED, { operatorId: ops.id }, o3.itemIds[0]);
    await job(o5.orderId, printerB, PrintJobStatus.FAILED, {}, o5.itemIds[0]);
    // a printed job on printerB accrues to its page usage (seeded directly)
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    await fx.prisma.printerPageUsage.create({
      data: { printerId: printerB, periodStart: start, pagesUsed: 40 },
    });

    // Shop B: its own order + payment that must never show in shop A's numbers.
    const orderB = await fx.prisma.order.create({
      data: {
        publicOrderNumber: `TEST-dashB-${randomUUID()}`,
        customerId: fx.customer.id,
        shopId: fx.shopB.id,
        branchId: await branchIdOf(fx.prisma, fx.shopB.id),
        documentId: (
          await fx.prisma.document.findFirstOrThrow({ where: { ownerUserId: fx.customer.id } })
        ).id,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: OrderStatus.WAITING_FOR_SHOP,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    shopBOrderId = orderB.id;
    fx.orderIds.push(orderB.id);
    created.paymentOrderIds.push(orderB.id);
    await fx.prisma.payment.create({
      data: {
        orderId: orderB.id,
        provider: "test",
        amountMinor: 99999,
        currency: "PKR",
        status: "PAID",
      },
    });
    await fx.prisma.inventoryItem.create({
      data: { shopId: fx.shop.id, name: "A4 low", paperSize: "A4", quantity: 1, minQuantity: 10 },
    });
  });

  afterAll(async () => {
    if (fx) {
      await fx.prisma.printerPageUsage.deleteMany({ where: { printerId: printerB } });
      await fx.prisma.payment.deleteMany({ where: { orderId: shopBOrderId } });
      await fx.prisma.order.deleteMany({ where: { id: shopBOrderId } });
      await fx.prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await fx.cleanup();
      await fx.prisma.user.deleteMany({ where: { id: adminId } });
    }
  });

  describe("owner dashboard (39)", () => {
    it("aggregates orders, revenue from confirmed payments, printing, printers, inventory and attention", async () => {
      const res = await http()
        .get("/v1/shop/dashboard/owner")
        .query({ shopId: fx.shop.id })
        .set(as(fx.token));
      expect(res.status).toBe(200);
      const b = res.body;
      expect(b.shopId).toBe(fx.shop.id);
      expect(b.currency).toBe("PKR");
      // draft is hidden; 5 visible orders
      expect(b.orders.today).toBe(5);
      expect(b.orders.inPeriod).toBe(5);
      expect(b.orders.byStatus).toEqual({
        PRINTING: 1,
        WAITING_FOR_SHOP: 1,
        COMPLETED: 1,
        CANCELLED: 1,
        PRINT_FAILED: 1,
      });
      // WAITING_FOR_SHOP + the PRINTING order is NOT stranded (its job is PRINTING)
      expect(b.orders.byGroup).toEqual({
        needsAttention: 1,
        printing: 1,
        ready: 0,
        completed: 1,
        failed: 2,
      });
      expect(b.orders.pending).toBe(1);
      expect(b.orders.completedInPeriod).toBe(1);
      expect(b.orders.current).toEqual({ needsAttention: 1, printing: 1, ready: 0 });
      // gross = everything ever paid (3000+1000+500+7777); refunded = the refund's 7000;
      // net = gross - refunded. Shop B's 99999 excluded.
      expect(b.revenue).toEqual({
        currency: "PKR",
        grossTodayMinor: 12277,
        refundedTodayMinor: 7000,
        netTodayMinor: 5277,
        grossPeriodMinor: 12277,
        refundedPeriodMinor: 7000,
        netPeriodMinor: 5277,
        paidOrdersInPeriod: 4,
      });
      expect(b.printing).toMatchObject({
        printingNow: 1,
        waitingInQueue: 1,
        jobsPrintedInPeriod: 1,
        pagesPrintedInPeriod: 5,
        jobsFailedInPeriod: 1,
      });
      expect(b.printers).toMatchObject({ total: 2, online: 1, offline: 1, other: 0 });
      expect(b.inventory).toMatchObject({
        trackingEnabled: false,
        activeItems: 1,
        lowStockCount: 1,
        outOfStockCount: 0,
        openAlertCount: 0,
      });
      expect(b.attention).toMatchObject({
        blockedJobs: 1,
        failedJobs: 1,
        unresolvedJobs: 0,
        ordersNeedingAttention: 1,
      });
    });

    it("a stranded printing order (blocked job) counts as needsAttention, like the orders list", async () => {
      const o = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
      await pay(o.orderId, 100, PaymentStatus.PAID);
      const j = await job(
        o.orderId,
        null,
        PrintJobStatus.WAITING,
        { blockedReason: "NO_PAPER" },
        o.itemIds[0],
      );
      const res = await http()
        .get("/v1/shop/dashboard/owner")
        .query({ shopId: fx.shop.id })
        .set(as(fx.manager.token));
      expect(res.status).toBe(200);
      expect(res.body.orders.byGroup.needsAttention).toBe(2);
      expect(res.body.orders.byGroup.printing).toBe(1);
      expect(res.body.orders.current.needsAttention).toBe(2);
      await fx.prisma.payment.deleteMany({ where: { orderId: o.orderId } });
      await fx.prisma.printJob.delete({ where: { id: j.id } });
      await fx.prisma.orderItem.deleteMany({ where: { orderId: o.orderId } });
      await fx.prisma.order.delete({ where: { id: o.orderId } });
    });

    it("the period is honoured and bounded", async () => {
      const past = await http()
        .get("/v1/shop/dashboard/owner")
        .query({
          shopId: fx.shop.id,
          from: "2020-01-01T00:00:00Z",
          to: "2020-01-31T00:00:00Z",
        })
        .set(as(fx.token));
      expect(past.status).toBe(200);
      expect(past.body.orders.inPeriod).toBe(0);
      expect(past.body.revenue.grossPeriodMinor).toBe(0);
      expect(past.body.revenue.netPeriodMinor).toBe(0);
      expect(past.body.revenue.netTodayMinor).toBe(5277); // "today" is independent of the period
      // live counts ignore the period
      expect(past.body.orders.current.needsAttention).toBe(1);
      const tooWide = await http()
        .get("/v1/shop/dashboard/owner")
        .query({ shopId: fx.shop.id, from: "2015-01-01T00:00:00Z", to: "2020-01-31T00:00:00Z" })
        .set(as(fx.token));
      expect(tooWide.status).toBe(400);
      const backwards = await http()
        .get("/v1/shop/dashboard/owner")
        .query({ shopId: fx.shop.id, from: "2021-01-01T00:00:00Z", to: "2020-01-31T00:00:00Z" })
        .set(as(fx.token));
      expect(backwards.status).toBe(400);
    });

    it("permissions and isolation: manager 200; operator, counter 403; shop B owner 403 for shop A; anonymous 401; shop B sees only its own", async () => {
      const q = { shopId: fx.shop.id };
      const get = (token?: string, query: object = q) => {
        const r = http().get("/v1/shop/dashboard/owner").query(query);
        return token ? r.set(as(token)) : r;
      };
      expect((await get(fx.manager.token)).status).toBe(200);
      expect((await get(fx.operator.token)).status).toBe(403);
      expect((await get(fx.counter.token)).status).toBe(403);
      expect((await get(fx.ownerB.token)).status).toBe(403);
      expect((await get()).status).toBe(401);
      expect((await get(adminToken)).status).toBe(403); // admin has no shop membership
      const own = await get(fx.ownerB.token, { shopId: fx.shopB.id });
      expect(own.status).toBe(200);
      expect(own.body.orders.inPeriod).toBe(1);
      expect(own.body.revenue.netPeriodMinor).toBe(99999);
      expect(own.body.printers.total).toBe(0);
      expect(own.body.inventory.activeItems).toBe(0);
    });
  });

  describe("operator dashboard (40)", () => {
    it("shows my current/assigned/waiting/blocked/completed jobs with priority and instructions", async () => {
      const res = await http()
        .get("/v1/shop/dashboard/operator")
        .query({ shopId: fx.shop.id })
        .set(as(fx.operator.token));
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(ops.id);
      expect(res.body.currentJobs).toHaveLength(1);
      expect(res.body.currentJobs[0]).toMatchObject({
        status: "PRINTING",
        printerName: "dash-A",
        instructions: {
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          copies: 2,
          pagesPerCopy: 5,
          totalPages: 10,
        },
      });
      expect(res.body.currentJobs[0].publicOrderNumber).toMatch(/^TEST-dash-/);
      expect(res.body.blocked.total).toBe(1);
      expect(res.body.blocked.items[0]).toMatchObject({ blockedReason: "NO_PAPER" });
      expect(res.body.completedToday.total).toBe(1);
      expect(res.body.myAssigned.total).toBe(0);
      expect(res.body.waiting.total).toBe(0);
    });

    it("a different operator sees their own (empty) assigned lists but the same shop-wide blocked jobs", async () => {
      const res = await http()
        .get("/v1/shop/dashboard/operator")
        .query({ shopId: fx.shop.id })
        .set(as(fx.manager.token));
      expect(res.status).toBe(200);
      expect(res.body.currentJobs).toHaveLength(0);
      expect(res.body.completedToday.total).toBe(0);
      expect(res.body.blocked.total).toBe(1);
    });

    it("permissions and isolation: counter 403, shop B 403, anonymous 401, other shop's owner sees none of A's jobs", async () => {
      const get = (token?: string, shopId = fx.shop.id) => {
        const r = http().get("/v1/shop/dashboard/operator").query({ shopId });
        return token ? r.set(as(token)) : r;
      };
      expect((await get(fx.counter.token)).status).toBe(403);
      expect((await get(fx.ownerB.token)).status).toBe(403);
      expect((await get()).status).toBe(401);
      const own = await get(fx.ownerB.token, fx.shopB.id);
      expect(own.status).toBe(200);
      expect(own.body.blocked.total).toBe(0);
      expect(own.body.waiting.total).toBe(0);
    });
  });

  describe("printer dashboard (41)", () => {
    it("shows status, queue depth, current job, page allowance and offline state per printer", async () => {
      const res = await http()
        .get("/v1/shop/dashboard/printers")
        .query({ shopId: fx.shop.id })
        .set(as(fx.operator.token));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const a = res.body.items.find((p: { name: string }) => p.name === "dash-A");
      const b = res.body.items.find((p: { name: string }) => p.name === "dash-B");
      expect(a).toMatchObject({
        status: "ONLINE",
        offline: false,
        currentJob: { status: "PRINTING" },
        queue: { jobs: 0, pages: 0 },
        pageLimit: { enabled: false, limit: null, remaining: null, pagesUsed: 0 },
      });
      expect(b).toMatchObject({
        status: "OFFLINE",
        offline: true,
        currentJob: null,
        pageLimit: { enabled: true, limit: 100, pagesUsed: 40, remaining: 60, period: "DAILY" },
        errors: { failedJobs24h: 1 },
      });
      expect(res.body.paper.bySize).toEqual([{ paperSize: "A4", quantity: 1, lowStockItems: 1 }]);
    });

    it("permissions and isolation", async () => {
      const get = (token?: string, shopId = fx.shop.id) => {
        const r = http().get("/v1/shop/dashboard/printers").query({ shopId });
        return token ? r.set(as(token)) : r;
      };
      expect((await get(fx.counter.token)).status).toBe(403);
      expect((await get(fx.ownerB.token)).status).toBe(403);
      expect((await get()).status).toBe(401);
      const own = await get(fx.ownerB.token, fx.shopB.id);
      expect(own.body.total).toBe(0);
      expect(own.body.paper.bySize).toEqual([]);
    });
  });

  describe("admin dashboard (42)", () => {
    it("ADMIN sees platform-wide counts, system health and no subscription model", async () => {
      const res = await http().get("/v1/admin/dashboard").set(as(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.businesses.total).toBeGreaterThanOrEqual(2);
      expect(res.body.businesses.byStatus.OPEN).toBeGreaterThanOrEqual(2);
      expect(res.body.users.byRole.SHOP_OWNER).toBeGreaterThanOrEqual(2);
      expect(res.body.orders.total).toBeGreaterThanOrEqual(5);
      expect(res.body.printers.total).toBeGreaterThanOrEqual(2);
      expect(res.body.system.ready).toBe(true);
      expect(res.body.system.checks.map((c: { name: string }) => c.name).sort()).toEqual([
        "postgres",
        "redis",
        "s3",
      ]);
      expect(res.body.storage.documents).toBeGreaterThanOrEqual(1);
      expect(res.body.subscriptions).toBeNull();
      expect(typeof res.body.errors.failedJobs24h).toBe("number");
      expect(typeof res.body.securityEvents24h.total).toBe("number");
    });

    it("27.6: revenueByShop reflects shop B's own today's payment, isolated from shop A's", async () => {
      const res = await http().get("/v1/admin/dashboard").set(as(adminToken));
      expect(res.status).toBe(200);
      const rows = res.body.revenueByShop as Array<{
        shopId: string;
        shopName: string;
        currency: string;
        grossTodayMinor: number;
        netTodayMinor: number;
      }>;
      const shopBRow = rows.find((row) => row.shopId === fx.shopB.id);
      expect(shopBRow).toBeDefined();
      expect(shopBRow).toMatchObject({
        currency: "PKR",
        grossTodayMinor: 99999,
        netTodayMinor: 99999,
      });
      // Sorted highest gross first.
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i]!.grossTodayMinor).toBeLessThanOrEqual(rows[i - 1]!.grossTodayMinor);
      }
    });

    it("everyone else is denied: shop owner 403, customer 403, anonymous 401", async () => {
      expect((await http().get("/v1/admin/dashboard").set(as(fx.token))).status).toBe(403);
      expect(
        (
          await http()
            .get("/v1/admin/dashboard")
            .set(as(fx.tokens.issueAccessToken(fx.customer)))
        ).status,
      ).toBe(403);
      expect((await http().get("/v1/admin/dashboard")).status).toBe(401);
    });
  });
});
