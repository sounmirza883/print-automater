import "reflect-metadata";
import {
  OrderStatus,
  PrinterStatus,
  PrintJobStatus,
  UserRole,
  type PrintJob,
} from "@prisma/client";
import {
  AppException,
  PrintJobEvent,
  PrintJobStateMachine,
  reallocateWaitingJobs,
} from "@print-automated/backend-shared";
import request from "supertest";
import { periodStart } from "@print-automated/backend-shared";
import { createPhase19Fixture, type Phase19Fixture } from "./helpers/phase19-fixture.js";

/** Step 3 / B4, the tests that matter most: a job is printed at the branch where its order was
 * placed, and nowhere else. A mistake here is a physical one (paper in the wrong city), so each
 * path that picks or changes a printer is proven to stay inside the branch, including when the
 * branch's own printers are offline or full, which must block the job with an explicit reason
 * instead of quietly using another branch's printer. Printers at branches A and B; everything
 * under test is created at B as well as A, and the other branch is checked to stay untouched. */
describe("Printing never crosses branches (step 3 / B4, e2e)", () => {
  let fx: Phase19Fixture;
  type Member = Awaited<ReturnType<Phase19Fixture["makeMember"]>>;
  let branchB: Awaited<ReturnType<Phase19Fixture["addBranch"]>>;
  let managerA: Member;

  const http = () => request(fx.app.getHttpServer());
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });

  const liveJobs = (orderId: string): Promise<PrintJob[]> =>
    fx.prisma.printJob.findMany({ where: { orderId, supersededAt: null } });
  const accept = (orderId: string, token: string = fx.token) =>
    http()
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set({ Authorization: `Bearer ${token}` })
      .send({});
  const setStatus = (printerId: string, status: PrinterStatus) =>
    fx.prisma.printer.update({ where: { id: printerId }, data: { status } });
  const jobsOn = (printerId: string) =>
    fx.prisma.printJob.count({ where: { printerId, supersededAt: null } });

  /** A job of an existing order, queued on a printer. */
  async function queueJob(orderId: string, printerId: string, branchId: string): Promise<PrintJob> {
    const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    return fx.prisma.printJob.create({
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
  }

  /** Every test gets printers of its own (names are unique) and puts every other printer of the
   * business out of the way, so the outcome can only be that test's. */
  async function isolate(keep: string[]): Promise<void> {
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: keep } },
      data: { status: PrinterStatus.DISABLED },
    });
  }

  beforeAll(async () => {
    fx = await createPhase19Fixture("bprint", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
    branchB = await fx.addBranch("B");
    managerA = await fx.makeMember(UserRole.SHOP_MANAGER, fx.branch.id);
  }, 60_000);

  afterAll(async () => {
    await fx.cleanup();
  });

  describe("allocation when an order is accepted", () => {
    it("puts a branch's order on that branch's printer, even when the other branch's is less loaded", async () => {
      const a = (await fx.makePrinter("alloc-A", {}, fx.branch.id)).printer;
      const b = (await fx.makePrinter("alloc-B", {}, branchB.id)).printer;
      await isolate([a.id, b.id]);
      // Branch A's printer is busy; branch B's is idle. A load balancer that looked at the whole
      // business would pick B for A's order.
      for (let i = 0; i < 3; i += 1) {
        const busy = await fx.makeOrder(
          1,
          1,
          OrderStatus.QUEUED_FOR_PRINT,
          undefined,
          fx.branch.id,
        );
        await queueJob(busy.orderId, a.id, fx.branch.id);
      }

      const orderA = (
        await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
      ).orderId;
      expect((await accept(orderA)).status).toBe(200);
      const jobs = await liveJobs(orderA);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        printerId: a.id,
        branchId: fx.branch.id,
        status: PrintJobStatus.QUEUED,
      });

      const orderB = (await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, branchB.id))
        .orderId;
      expect((await accept(orderB)).status).toBe(200);
      const jobsB = await liveJobs(orderB);
      expect(jobsB[0]).toMatchObject({
        printerId: b.id,
        branchId: branchB.id,
        status: PrintJobStatus.QUEUED,
      });
      expect(await jobsOn(b.id)).toBe(1);
    });

    it("blocks the job when its own branch's printer is offline, rather than using the other branch's", async () => {
      const a = (await fx.makePrinter("off-A", { status: PrinterStatus.OFFLINE }, fx.branch.id))
        .printer;
      const b = (await fx.makePrinter("off-B", {}, branchB.id)).printer;
      await isolate([a.id, b.id]);

      const orderA = (
        await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
      ).orderId;
      expect((await accept(orderA)).status).toBe(200);
      const [job] = await liveJobs(orderA);
      expect(job).toMatchObject({
        status: PrintJobStatus.WAITING,
        printerId: null,
        branchId: fx.branch.id,
        blockedReason: "PRINTER_OFFLINE",
      });
      expect(await jobsOn(b.id)).toBe(0);
    });

    it("blocks the job when its own branch's printer is at its page limit", async () => {
      const a = (
        await fx.makePrinter(
          "limit-A",
          { pageLimit: 1, pageLimitEnabled: true, pageLimitPeriod: "DAILY" },
          fx.branch.id,
        )
      ).printer;
      const b = (await fx.makePrinter("limit-B", {}, branchB.id)).printer;
      await isolate([a.id, b.id]);
      await fx.prisma.printerPageUsage.create({
        data: { printerId: a.id, periodStart: periodStart("DAILY", new Date()), pagesUsed: 1 },
      });

      const orderA = (
        await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
      ).orderId;
      expect((await accept(orderA)).status).toBe(200);
      const [job] = await liveJobs(orderA);
      expect(job).toMatchObject({
        status: PrintJobStatus.WAITING,
        printerId: null,
        blockedReason: "PAGE_LIMIT_REACHED",
      });
      expect(await jobsOn(b.id)).toBe(0);
    });

    it("refuses outright (old single-job mode) when the branch has no usable printer", async () => {
      const a = (await fx.makePrinter("legacy-A", { status: PrinterStatus.OFFLINE }, fx.branch.id))
        .printer;
      const b = (await fx.makePrinter("legacy-B", {}, branchB.id)).printer;
      await isolate([a.id, b.id]);
      await fx.prisma.shop.update({ where: { id: fx.shop.id }, data: { multiItemEnabled: false } });
      try {
        const orderA = (
          await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
        ).orderId;
        const res = await accept(orderA);
        expect(res.status).toBe(409);
        expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");
        expect(await fx.prisma.printJob.count({ where: { orderId: orderA } })).toBe(0);
        expect(await jobsOn(b.id)).toBe(0);
      } finally {
        await fx.prisma.shop.update({
          where: { id: fx.shop.id },
          data: { multiItemEnabled: true },
        });
      }
    });

    it("a printer at another branch cannot be named when retrying a failed order (change printer)", async () => {
      const a = (await fx.makePrinter("chg-A", {}, fx.branch.id)).printer;
      const b = (await fx.makePrinter("chg-B", {}, branchB.id)).printer;
      await isolate([a.id, b.id]);
      const orderA = (await fx.makeOrder(1, 1, OrderStatus.PRINT_FAILED, undefined, fx.branch.id))
        .orderId;
      const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId: orderA } });
      const failed = await fx.prisma.printJob.create({
        data: {
          orderId: orderA,
          shopId: fx.shop.id,
          branchId: fx.branch.id,
          orderItemId: item.id,
          printerId: a.id,
          attempt: 1,
          idempotencyToken: `${item.id}:1`,
          status: PrintJobStatus.FAILED,
        },
      });

      const wrong = await http()
        .post(`/v1/shop/orders/${orderA}/change-printer`)
        .set(owner())
        .send({ printerId: b.id });
      expect(wrong.status).toBe(409);
      expect(wrong.body.error_code).toBe("PRINTER_WRONG_BRANCH");
      const still = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: failed.id } });
      expect(still).toMatchObject({ status: PrintJobStatus.FAILED, supersededAt: null });
      expect(await jobsOn(b.id)).toBe(0);

      // Its own branch's printer is fine.
      const right = await http()
        .post(`/v1/shop/orders/${orderA}/change-printer`)
        .set(owner())
        .send({ printerId: a.id });
      expect(right.status).toBe(200);
    });
  });

  describe("failover (a printer is switched off) and queue recovery", () => {
    const disable = (printerId: string) =>
      http().patch(`/v1/shop/printers/${printerId}`).set(owner()).send({ enabled: false });

    it("moves jobs to another printer of the SAME branch", async () => {
      const a1 = (await fx.makePrinter("fo-A1", {}, fx.branch.id)).printer;
      const a2 = (await fx.makePrinter("fo-A2", {}, fx.branch.id)).printer;
      const b1 = (await fx.makePrinter("fo-B1", {}, branchB.id)).printer;
      await isolate([a1.id, a2.id, b1.id]);
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
      ).orderId;
      await queueJob(order, a1.id, fx.branch.id);

      expect((await disable(a1.id)).status).toBe(200);
      const [moved] = await liveJobs(order);
      expect(moved).toMatchObject({
        status: PrintJobStatus.QUEUED,
        printerId: a2.id,
        branchId: fx.branch.id,
      });
      expect(await jobsOn(b1.id)).toBe(0);
    });

    it("parks the job with an explicit reason when the branch has nothing else, never on another branch's printer", async () => {
      const a1 = (await fx.makePrinter("fo2-A1", {}, fx.branch.id)).printer;
      const a2 = (await fx.makePrinter("fo2-A2", { status: PrinterStatus.OFFLINE }, fx.branch.id))
        .printer;
      const b1 = (await fx.makePrinter("fo2-B1", {}, branchB.id)).printer;
      await isolate([a1.id, a2.id, b1.id]);
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
      ).orderId;
      await queueJob(order, a1.id, fx.branch.id);

      expect((await disable(a1.id)).status).toBe(200);
      const [parked] = await liveJobs(order);
      expect(parked).toMatchObject({
        status: PrintJobStatus.WAITING,
        printerId: null,
        branchId: fx.branch.id,
      });
      expect(parked!.blockedReason).not.toBeNull();
      expect(await jobsOn(b1.id)).toBe(0);
    });

    it("works the same at the second branch, and the first stays untouched", async () => {
      const b1 = (await fx.makePrinter("fo3-B1", {}, branchB.id)).printer;
      const b2 = (await fx.makePrinter("fo3-B2", {}, branchB.id)).printer;
      const a1 = (await fx.makePrinter("fo3-A1", {}, fx.branch.id)).printer;
      await isolate([b1.id, b2.id, a1.id]);
      const order = (await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, branchB.id))
        .orderId;
      await queueJob(order, b1.id, branchB.id);

      expect((await disable(b1.id)).status).toBe(200);
      const [moved] = await liveJobs(order);
      expect(moved).toMatchObject({ printerId: b2.id, branchId: branchB.id });
      expect(await jobsOn(a1.id)).toBe(0);
    });

    it("recovery only re-allocates a waiting job onto its own branch's printer", async () => {
      const a1 = (await fx.makePrinter("rec-A1", { status: PrinterStatus.OFFLINE }, fx.branch.id))
        .printer;
      const b1 = (await fx.makePrinter("rec-B1", {}, branchB.id)).printer;
      await isolate([a1.id, b1.id]);
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
      ).orderId;
      expect((await accept(order)).status).toBe(200);
      const [waiting] = await liveJobs(order);
      expect(waiting).toMatchObject({
        status: PrintJobStatus.WAITING,
        blockedReason: "PRINTER_OFFLINE",
      });

      const deps = { prisma: fx.prisma, jobMachine: fx.app.get(PrintJobStateMachine) };
      // Only the other branch's printer is online: the job must stay parked.
      const first = await reallocateWaitingJobs(deps, { shopId: fx.shop.id });
      expect(first.outcomes.filter((o) => o.jobId === waiting!.id)).toEqual([
        { jobId: waiting!.id, action: "STILL_BLOCKED" },
      ]);
      expect(await jobsOn(b1.id)).toBe(0);
      expect(
        (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: waiting!.id } })).status,
      ).toBe(PrintJobStatus.WAITING);

      // Its own branch's printer comes back: now it is allocated, there.
      await setStatus(a1.id, PrinterStatus.ONLINE);
      const second = await reallocateWaitingJobs(deps, { shopId: fx.shop.id });
      expect(second.outcomes.find((o) => o.jobId === waiting!.id)).toMatchObject({
        action: "ALLOCATED",
        printerId: a1.id,
      });
      expect(await jobsOn(b1.id)).toBe(0);
    });
  });

  describe("manual changes by staff", () => {
    it("refuses reassigning a job to another branch's printer, and allows its own branch's", async () => {
      const a1 = (await fx.makePrinter("man-A1", {}, fx.branch.id)).printer;
      const a2 = (await fx.makePrinter("man-A2", {}, fx.branch.id)).printer;
      const b1 = (await fx.makePrinter("man-B1", {}, branchB.id)).printer;
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
      ).orderId;
      const job = await queueJob(order, a1.id, fx.branch.id);

      for (const actor of [owner(), { Authorization: `Bearer ${managerA.token}` }]) {
        const wrong = await http()
          .post(`/v1/print-jobs/${job.id}/reassign`)
          .set(actor)
          .send({ printerId: b1.id, reason: "wrong city" });
        expect(wrong.status).toBe(409);
        expect(wrong.body.error_code).toBe("PRINTER_WRONG_BRANCH");
      }
      const untouched = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(untouched).toMatchObject({ status: PrintJobStatus.QUEUED, printerId: a1.id });
      expect(await jobsOn(b1.id)).toBe(0);

      const right = await http()
        .post(`/v1/print-jobs/${job.id}/reassign`)
        .set(owner())
        .send({ printerId: a2.id, reason: "rebalance" });
      expect(right.status).toBe(200);
      expect(right.body).toMatchObject({ printerId: a2.id, branchId: fx.branch.id });
    });

    it("refuses resuming a paused job onto another branch's printer", async () => {
      const a1 = (await fx.makePrinter("res-A1", {}, fx.branch.id)).printer;
      const b1 = (await fx.makePrinter("res-B1", {}, branchB.id)).printer;
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
      ).orderId;
      const job = await queueJob(order, a1.id, fx.branch.id);
      expect(
        (await http().post(`/v1/print-jobs/${job.id}/pause`).set(owner()).send({})).status,
      ).toBe(200);

      const wrong = await http()
        .post(`/v1/print-jobs/${job.id}/resume`)
        .set(owner())
        .send({ printerId: b1.id });
      expect(wrong.status).toBe(409);
      expect(wrong.body.error_code).toBe("PRINTER_WRONG_BRANCH");
      expect((await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        PrintJobStatus.PAUSED,
      );

      // Resuming without naming one allocates within the branch.
      const auto = await http().post(`/v1/print-jobs/${job.id}/resume`).set(owner()).send({});
      expect(auto.status).toBe(200);
      const resumed = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
      if (resumed.printerId !== null) {
        const where = await fx.prisma.printer.findUniqueOrThrow({
          where: { id: resumed.printerId },
        });
        expect(where.branchId).toBe(fx.branch.id);
      }
      expect(await jobsOn(b1.id)).toBe(0);
    });

    it("refuses reprinting a printed job on another branch's printer", async () => {
      const a1 = (await fx.makePrinter("rep-A1", {}, fx.branch.id)).printer;
      const b1 = (await fx.makePrinter("rep-B1", {}, branchB.id)).printer;
      const order = (await fx.makeOrder(1, 1, OrderStatus.PRINTED, undefined, fx.branch.id))
        .orderId;
      const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId: order } });
      const printed = await fx.prisma.printJob.create({
        data: {
          orderId: order,
          shopId: fx.shop.id,
          branchId: fx.branch.id,
          orderItemId: item.id,
          printerId: a1.id,
          attempt: 1,
          idempotencyToken: `${item.id}:1`,
          status: PrintJobStatus.PRINTED,
        },
      });
      const res = await http()
        .post(`/v1/print-jobs/${printed.id}/reprint`)
        .set(owner())
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ reason: "POOR_QUALITY", printerId: b1.id });
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("PRINTER_WRONG_BRANCH");
      expect(await fx.prisma.printJob.count({ where: { orderId: order } })).toBe(1);
    });

    it("only lets an operator of the job's own branch (or of all branches) be assigned", async () => {
      const a1 = (await fx.makePrinter("op-A1", {}, fx.branch.id)).printer;
      const operatorA = await fx.makeMember(UserRole.OPERATOR, fx.branch.id);
      const operatorB = await fx.makeMember(UserRole.OPERATOR, branchB.id);
      const operatorAll = await fx.makeMember(UserRole.OPERATOR, null);
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
      ).orderId;
      const job = await queueJob(order, a1.id, fx.branch.id);
      const assign = (operatorId: string) =>
        http().post(`/v1/print-jobs/${job.id}/assign-operator`).set(owner()).send({ operatorId });

      const other = await assign(operatorB.user.id);
      expect(other.status).toBe(409);
      expect(other.body.error_code).toBe("INVALID_OPERATOR");
      expect((await assign(operatorA.user.id)).status).toBe(200);
      expect((await assign(operatorAll.user.id)).status).toBe(200);
    });
  });

  describe("the job machine itself is the last line of defence", () => {
    it("will not hand a job a printer of another branch, however it is asked", async () => {
      const a1 = (await fx.makePrinter("mach-A1", {}, fx.branch.id)).printer;
      const b1 = (await fx.makePrinter("mach-B1", {}, branchB.id)).printer;
      const order = (
        await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
      ).orderId;
      const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId: order } });
      const waiting = await fx.prisma.printJob.create({
        data: {
          orderId: order,
          shopId: fx.shop.id,
          branchId: fx.branch.id,
          orderItemId: item.id,
          printerId: null,
          attempt: 1,
          idempotencyToken: `${item.id}:1`,
          status: PrintJobStatus.WAITING,
          blockedReason: "PRINTER_OFFLINE",
        },
      });
      const machine = fx.app.get(PrintJobStateMachine);

      const refused = (await machine
        .transition(waiting.id, PrintJobEvent.ALLOCATE, { id: null }, { printerId: b1.id })
        .catch((error: unknown) => error)) as AppException;
      expect(refused).toBeInstanceOf(AppException);
      expect(refused.errorCode).toBe("PRINTER_WRONG_BRANCH");
      expect(
        (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: waiting.id } })).status,
      ).toBe(PrintJobStatus.WAITING);

      // A successor created by SUPERSEDE is held to the same rule.
      const queued = await queueJob(
        (await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)).orderId,
        a1.id,
        fx.branch.id,
      );
      const refusedSuccessor = (await machine
        .transition(
          queued.id,
          PrintJobEvent.SUPERSEDE,
          { id: null },
          { successor: { printerId: b1.id } },
        )
        .catch((error: unknown) => error)) as AppException;
      expect(refusedSuccessor.errorCode).toBe("PRINTER_WRONG_BRANCH");
      expect(
        (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: queued.id } })).status,
      ).toBe(PrintJobStatus.QUEUED);

      // Its own branch's printer is accepted, and the successor keeps the branch.
      const ok = await machine.transition(
        queued.id,
        PrintJobEvent.SUPERSEDE,
        { id: null },
        { successor: { printerId: a1.id } },
      );
      const successor = await fx.prisma.printJob.findUniqueOrThrow({
        where: { id: ok.successorJobId! },
      });
      expect(successor).toMatchObject({ branchId: fx.branch.id, printerId: a1.id });
    });
  });
});
