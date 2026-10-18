import { OrderStatus } from "@prisma/client";
import request from "supertest";
import {
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  reallocateWaitingJobs,
  reevaluatePrinterJobs,
} from "@print-automated/backend-shared";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

/** 19.16. The risk list always required these and Phase 18 did not write them:
 * each background sweep RACING a staff retry on the same order, fired with
 * Promise.all (never sequential awaits), against the REAL retry-print endpoint.
 * The sweeps' own primitives are called exactly as the worker calls them
 * (the print-timeout sweep = jobMachine TIMEOUT per stale job; the offline
 * sweep = reevaluatePrinterJobs; recovery = reallocateWaitingJobs).
 *
 * Whichever side wins, the invariants must hold: no request 5xx (a deadlock
 * would be a 40P01 -> 500), and EVERY item ends with exactly ONE live
 * (non-superseded) job -- never two (a duplicate print) and never zero. */
const ITERATIONS = 6;

describe("Sweeps racing a staff retry (19.16, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("sweep-race", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  /** Two-item order: item 0 already TIMED OUT (so staff can retry), item 1 is
   * `secondStatus` on `printerId`. */
  async function seed(printerId: string, secondStatus: "QUEUED" | "WAITING") {
    const { orderId, itemIds } = await fx.makeOrder(2, 1, OrderStatus.PRINT_FAILED);
    const first = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        branchId: await branchIdOf(fx.prisma, fx.shop.id),
        orderItemId: itemIds[0]!,
        printerId,
        status: "TIMEOUT",
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    const second = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        branchId: await branchIdOf(fx.prisma, fx.shop.id),
        orderItemId: itemIds[1]!,
        printerId: secondStatus === "QUEUED" ? printerId : null,
        status: secondStatus,
        blockedReason: secondStatus === "WAITING" ? "PRINTER_OFFLINE" : null,
        idempotencyToken: `${itemIds[1]}:1`,
      },
    });
    return { orderId, itemIds, first, second };
  }

  const retry = (orderId: string) =>
    request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/retry-print`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({});

  async function expectOneLiveJobPerItem(itemIds: string[]): Promise<void> {
    for (const itemId of itemIds) {
      const live = await fx.prisma.printJob.findMany({
        where: { orderItemId: itemId, supersededAt: null },
      });
      expect({ itemId, live: live.length }).toEqual({ itemId, live: 1 });
    }
  }

  it("print-timeout sweep vs staff retry: no deadlock, one live job per item", async () => {
    const a = await fx.makePrinter("T-A");
    const machine = fx.app.get(PrintJobStateMachine);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const s = await seed(a.printer.id, "QUEUED");
      const [res, timedOut] = await Promise.all([
        retry(s.orderId),
        // exactly what PrintTimeoutProcessor does for a stale QUEUED job
        machine
          .transition(
            s.second.id,
            PrintJobEvent.TIMEOUT,
            { id: null },
            { metadata: { reason: "timeout" } },
          )
          .then(() => "ok" as const)
          .catch((e: { errorCode?: string }) => e.errorCode ?? "error"),
      ]);
      expect(res.status).toBeLessThan(500);
      expect(["ok", "ILLEGAL_JOB_TRANSITION"]).toContain(timedOut);
      await expectOneLiveJobPerItem(s.itemIds);
    }
  });

  it("offline sweep failover vs staff retry: no deadlock, one live job per item", async () => {
    const a = await fx.makePrinter("O-A");
    const b = await fx.makePrinter("O-B");
    const prisma = fx.app.get(PrismaService);
    const machine = fx.app.get(PrintJobStateMachine);
    await prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    for (let i = 0; i < ITERATIONS; i += 1) {
      await prisma.printer.update({ where: { id: a.printer.id }, data: { status: "ONLINE" } });
      const s = await seed(a.printer.id, "QUEUED");
      // the sweep's own UPDATE flipped A offline; now it reacts
      await prisma.printer.update({ where: { id: a.printer.id }, data: { status: "OFFLINE" } });
      const [res, moved] = await Promise.all([
        retry(s.orderId),
        reevaluatePrinterJobs(
          { prisma, jobMachine: machine },
          { shopId: fx.shop.id, printerId: a.printer.id, trigger: "PRINTER_ERROR" },
        ),
      ]);
      expect(res.status).toBeLessThan(500);
      expect(moved.errors).toEqual([]);
      await expectOneLiveJobPerItem(s.itemIds);
    }
  });

  it("queue recovery vs staff retry: no deadlock, one live job per item", async () => {
    const a = await fx.makePrinter("R-A");
    const prisma = fx.app.get(PrismaService);
    const machine = fx.app.get(PrintJobStateMachine);
    await prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { not: a.printer.id } },
      data: { status: "DISABLED" },
    });
    await prisma.printer.update({ where: { id: a.printer.id }, data: { status: "ONLINE" } });
    for (let i = 0; i < ITERATIONS; i += 1) {
      const s = await seed(a.printer.id, "WAITING");
      const [res, recovered] = await Promise.all([
        retry(s.orderId),
        reallocateWaitingJobs({ prisma, jobMachine: machine }, { shopId: fx.shop.id }),
      ]);
      expect(res.status).toBeLessThan(500);
      expect(recovered.errors).toEqual([]);
      await expectOneLiveJobPerItem(s.itemIds);
    }
  });
});
