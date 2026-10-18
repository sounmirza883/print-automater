import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { OrderStatus, PrinterStatus, PrintJobStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture } from "./helpers/phase19-fixture.js";

/** Step 3 / B2: a branch-bound person only ever sees and touches their own branch. Two branches,
 * each with an order, a queued print job and a printer. For every route that takes another
 * branch's order, print job or printer id, a manager bound to the OTHER branch gets 403 and
 * nothing changes; a list is limited to their own branch (naming another is 403); and people who
 * work at all branches (the owner, an area manager) see everything and can narrow any list. */
describe("Branch scope on orders, print jobs and printers (step 3 / B2, e2e)", () => {
  let fx: Phase19Fixture;
  type Member = Awaited<ReturnType<Phase19Fixture["makeMember"]>>;
  let branchB: Awaited<ReturnType<Phase19Fixture["addBranch"]>>;
  let managerA: Member;
  let managerB: Member;
  let roaming: Member;

  let printerA: string;
  let printerB: string;
  let orderA: string; // waiting for the shop, at A
  let orderB: string;
  let jobOrderA: string; // in production, with one queued job, at A
  let jobOrderB: string;
  let jobA: string;
  let jobB: string;

  const http = () => request(fx.app.getHttpServer());
  const as = (member: { token: string }) => ({ Authorization: `Bearer ${member.token}` });
  const owner = () => ({ token: fx.token });

  async function makeJob(orderId: string, printerId: string, branchId: string): Promise<string> {
    const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const job = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        branchId,
        orderItemId: item.id,
        printerId,
        attempt: 1,
        idempotencyToken: `${item.id}:1`,
        status: PrintJobStatus.QUEUED,
      },
    });
    return job.id;
  }

  beforeAll(async () => {
    fx = await createPhase19Fixture("bscope", { multiItemEnabled: true });
    branchB = await fx.addBranch("B");
    managerA = await fx.makeMember(UserRole.SHOP_MANAGER, fx.branch.id);
    managerB = await fx.makeMember(UserRole.SHOP_MANAGER, branchB.id);
    roaming = await fx.makeMember(UserRole.SHOP_MANAGER, null);

    printerA = (await fx.makePrinter("bscope-A", {}, fx.branch.id)).printer.id;
    printerB = (await fx.makePrinter("bscope-B", {}, branchB.id)).printer.id;
    orderA = (await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id))
      .orderId;
    orderB = (await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, branchB.id))
      .orderId;
    jobOrderA = (await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id))
      .orderId;
    jobOrderB = (await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, branchB.id))
      .orderId;
    jobA = await makeJob(jobOrderA, printerA, fx.branch.id);
    jobB = await makeJob(jobOrderB, printerB, branchB.id);
  }, 60_000);

  afterAll(async () => {
    await fx.cleanup();
  });

  describe("one thing by id: another branch's order, job or printer is 403 and untouched", () => {
    type Call = [string, string, (id: string) => string, unknown?];

    const orderCalls: Call[] = [
      ["GET", "order detail", (id) => `/v1/shop/orders/${id}`],
      ["GET", "order history", (id) => `/v1/shop/orders/${id}/history`],
      ["GET", "order invoice", (id) => `/v1/shop/orders/${id}/invoice`],
      ["POST", "accept", (id) => `/v1/shop/orders/${id}/accept`, {}],
      ["POST", "reject", (id) => `/v1/shop/orders/${id}/reject`, { reason: "SHOP_UNAVAILABLE" }],
      ["POST", "ready", (id) => `/v1/shop/orders/${id}/ready`, {}],
      ["POST", "complete", (id) => `/v1/shop/orders/${id}/complete`, {}],
      ["POST", "retry print", (id) => `/v1/shop/orders/${id}/retry-print`, {}],
      [
        "POST",
        "resolve unknown",
        (id) => `/v1/shop/orders/${id}/resolve-unknown`,
        { resolution: "MARK_FAILED" },
      ],
      [
        "POST",
        "change printer",
        (id) => `/v1/shop/orders/${id}/change-printer`,
        { printerId: randomUUID() },
      ],
      [
        "POST",
        "quality check",
        (id) => `/v1/shop/orders/${id}/quality-check`,
        { result: "PASSED" },
      ],
      ["POST", "record payment", (id) => `/v1/shop/orders/${id}/record-payment`, {}],
      ["GET", "delivery", (id) => `/v1/shop/orders/${id}/delivery`],
      [
        "PUT",
        "save delivery",
        (id) => `/v1/shop/orders/${id}/delivery`,
        { address: "1 Road, Lahore", courier: "TCS" },
      ],
      [
        "POST",
        "delivery status",
        (id) => `/v1/shop/orders/${id}/delivery/status`,
        { status: "DELIVERED" },
      ],
    ];
    const jobCalls: Call[] = [
      [
        "POST",
        "reassign",
        (id) => `/v1/print-jobs/${id}/reassign`,
        { printerId: randomUUID(), reason: "balance" },
      ],
      [
        "POST",
        "assign operator",
        (id) => `/v1/print-jobs/${id}/assign-operator`,
        { operatorId: null },
      ],
      ["POST", "pause", (id) => `/v1/print-jobs/${id}/pause`, {}],
      ["POST", "resume", (id) => `/v1/print-jobs/${id}/resume`, {}],
      ["POST", "reprint", (id) => `/v1/print-jobs/${id}/reprint`, { reason: "POOR_QUALITY" }],
      [
        "POST",
        "failure reason",
        (id) => `/v1/print-jobs/${id}/failure-reason`,
        { reason: "PAPER_JAM" },
      ],
    ];
    const printerCalls: Call[] = [
      ["GET", "printer detail", (id) => `/v1/shop/printers/${id}`],
      ["PATCH", "edit printer", (id) => `/v1/shop/printers/${id}`, { name: "hijacked" }],
      ["DELETE", "remove printer", (id) => `/v1/shop/printers/${id}`],
    ];

    async function call(
      member: { token: string },
      [method, , path, body]: Call,
      id: string,
      headers: Record<string, string> = {},
    ) {
      const req = http()[method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"](
        path(id),
      );
      req.set(as(member));
      req.set(headers);
      return body === undefined ? req : req.send(body as object);
    }

    it.each(orderCalls)("%s: %s on another branch's order is 403", async (...rest) => {
      const res = await call(managerB, [...rest] as unknown as Call, orderA);
      expect(res.status).toBe(403);
    });

    it.each(jobCalls)("%s: %s on another branch's print job is 403", async (...rest) => {
      const res = await call(managerB, [...rest] as unknown as Call, jobA, {
        "Idempotency-Key": randomUUID(),
      });
      expect(res.status).toBe(403);
    });

    it.each(printerCalls)("%s: %s on another branch's printer is 403", async (...rest) => {
      const res = await call(managerB, [...rest] as unknown as Call, printerA);
      expect(res.status).toBe(403);
    });

    it("left every one of those untouched", async () => {
      const order = await fx.prisma.order.findUniqueOrThrow({
        where: { id: orderA },
        include: { printJobs: true, delivery: true, payments: true },
      });
      expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
      expect(order.printJobs).toHaveLength(0);
      expect(order.delivery).toBeNull();
      expect(order.payments).toHaveLength(0);

      const job = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobA } });
      expect(job).toMatchObject({
        status: PrintJobStatus.QUEUED,
        printerId: printerA,
        supersededAt: null,
        operatorId: null,
        pausedAt: null,
      });
      expect(await fx.prisma.printJob.count({ where: { orderId: jobOrderA } })).toBe(1);

      const printer = await fx.prisma.printer.findUniqueOrThrow({ where: { id: printerA } });
      expect(printer.name).toBe("bscope-A");
      expect(printer.status).toBe(PrinterStatus.ONLINE);
    });

    it("works the other way round too: a manager of A cannot reach B's things", async () => {
      expect((await call(managerA, orderCalls[0]!, orderB)).status).toBe(403);
      expect((await call(managerA, jobCalls[2]!, jobB)).status).toBe(403);
      expect((await call(managerA, printerCalls[0]!, printerB)).status).toBe(403);
    });

    it("lets a branch's own manager read and act on their own branch's things", async () => {
      expect((await call(managerA, orderCalls[0]!, orderA)).status).toBe(200);
      expect((await call(managerA, orderCalls[1]!, orderA)).status).toBe(200);
      expect((await call(managerA, printerCalls[0]!, printerA)).status).toBe(200);
      expect((await call(managerB, orderCalls[0]!, orderB)).status).toBe(200);
      expect((await call(managerB, printerCalls[0]!, printerB)).status).toBe(200);
      // A write inside their own branch: pausing their own queued job.
      const paused = await call(managerB, jobCalls[2]!, jobB);
      expect(paused.status).toBe(200);
      expect(paused.body.branchId).toBe(branchB.id);
      expect(paused.body.branchName).toBe(branchB.name);
    });

    it("lets the owner and an all-branches manager reach both branches", async () => {
      for (const person of [owner(), roaming]) {
        expect((await call(person, orderCalls[0]!, orderA)).status).toBe(200);
        expect((await call(person, orderCalls[0]!, orderB)).status).toBe(200);
        expect((await call(person, printerCalls[0]!, printerA)).status).toBe(200);
        expect((await call(person, printerCalls[0]!, printerB)).status).toBe(200);
      }
    });
  });

  describe("lists: limited to the person's branch, or narrowed by an all-branches person", () => {
    const idsOf = (body: { items?: Array<{ id: string }> } & Record<string, unknown>): string[] => {
      if (body.items) return body.items.map((o) => o.id);
      return Object.values(body).flatMap((group) =>
        Array.isArray(group) ? (group as Array<{ id: string }>).map((o) => o.id) : [],
      );
    };
    const orders = (member: { token: string }, query: Record<string, string> = {}) =>
      http()
        .get("/v1/shop/orders")
        .query({ shopId: fx.shop.id, ...query })
        .set(as(member));
    const search = (member: { token: string }, query: Record<string, string> = {}) =>
      http()
        .get("/v1/shop/orders/search")
        .query({ shopId: fx.shop.id, ...query })
        .set(as(member));
    const printers = (member: { token: string }, query: Record<string, string> = {}) =>
      http()
        .get("/v1/shop/printers")
        .query({ shopId: fx.shop.id, ...query })
        .set(as(member));

    it("orders (grouped): a branch-bound manager only gets their own branch's orders", async () => {
      const res = await orders(managerB);
      expect(res.status).toBe(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([orderB, jobOrderB]));
      expect(ids).not.toContain(orderA);
      expect(ids).not.toContain(jobOrderA);
      const all = Object.values(res.body).flat() as Array<{ branchId: string; branchName: string }>;
      expect(all.every((o) => o.branchId === branchB.id && o.branchName === branchB.name)).toBe(
        true,
      );
    });

    it("orders: naming another branch is 403, naming their own is fine", async () => {
      expect((await orders(managerB, { branchId: fx.branch.id })).status).toBe(403);
      const own = await orders(managerB, { branchId: branchB.id });
      expect(own.status).toBe(200);
      expect(idsOf(own.body)).toContain(orderB);
    });

    it("orders: an all-branches person sees both, and can narrow to either", async () => {
      for (const person of [owner(), roaming]) {
        const all = idsOf((await orders(person)).body);
        expect(all).toEqual(expect.arrayContaining([orderA, orderB]));
        const onlyB = idsOf((await orders(person, { branchId: branchB.id })).body);
        expect(onlyB).toContain(orderB);
        expect(onlyB).not.toContain(orderA);
        const onlyA = idsOf((await orders(person, { branchId: fx.branch.id })).body);
        expect(onlyA).toContain(orderA);
        expect(onlyA).not.toContain(orderB);
      }
    });

    it("orders (a page of one group): same rules", async () => {
      const mine = await orders(managerB, { group: "needsAttention", limit: "50" });
      expect(mine.status).toBe(200);
      expect(idsOf(mine.body)).toContain(orderB);
      expect(idsOf(mine.body)).not.toContain(orderA);
      expect(mine.body.total).toBe(idsOf(mine.body).length);
      expect(
        (await orders(managerB, { group: "needsAttention", limit: "50", branchId: fx.branch.id }))
          .status,
      ).toBe(403);
      const narrowed = await orders(owner(), {
        group: "needsAttention",
        limit: "50",
        branchId: fx.branch.id,
      });
      expect(idsOf(narrowed.body)).toContain(orderA);
      expect(idsOf(narrowed.body)).not.toContain(orderB);
    });

    it("order search: scoped the same way, so a number from another branch finds nothing", async () => {
      const numberA = (await fx.prisma.order.findUniqueOrThrow({ where: { id: orderA } }))
        .publicOrderNumber;
      const numberB = (await fx.prisma.order.findUniqueOrThrow({ where: { id: orderB } }))
        .publicOrderNumber;
      const foreign = await search(managerB, { q: numberA });
      expect(foreign.status).toBe(200);
      expect(foreign.body.total).toBe(0);
      const own = await search(managerB, { q: numberB });
      expect(own.body.total).toBe(1);
      expect((await search(managerB, { q: numberA, branchId: fx.branch.id })).status).toBe(403);
      expect((await search(owner(), { q: numberA })).body.total).toBe(1);
      expect((await search(owner(), { q: numberA, branchId: branchB.id })).body.total).toBe(0);
      expect((await search(owner(), { q: numberA, branchId: fx.branch.id })).body.total).toBe(1);
    });

    it("printers: a branch-bound manager only gets their own branch's printers, with the branch", async () => {
      const res = await printers(managerB);
      expect(res.status).toBe(200);
      const list = res.body as Array<{ id: string; branchId: string; branchName: string }>;
      expect(list.map((p) => p.id)).toContain(printerB);
      expect(list.map((p) => p.id)).not.toContain(printerA);
      expect(list.every((p) => p.branchId === branchB.id && p.branchName === branchB.name)).toBe(
        true,
      );
      expect((await printers(managerB, { branchId: fx.branch.id })).status).toBe(403);
      expect((await printers(managerB, { limit: "50", branchId: fx.branch.id })).status).toBe(403);
    });

    it("printers (a page): scoped and narrowable", async () => {
      const mine = await printers(managerA, { limit: "50" });
      expect((mine.body.items as Array<{ id: string }>).map((p) => p.id)).toEqual([printerA]);
      expect(mine.body.total).toBe(1);

      for (const person of [owner(), roaming]) {
        const all = await printers(person, { limit: "50" });
        expect((all.body.items as Array<{ id: string }>).map((p) => p.id)).toEqual(
          expect.arrayContaining([printerA, printerB]),
        );
        const onlyB = await printers(person, { limit: "50", branchId: branchB.id });
        expect((onlyB.body.items as Array<{ id: string }>).map((p) => p.id)).toEqual([printerB]);
        expect(onlyB.body.total).toBe(1);
      }
    });
  });
});
