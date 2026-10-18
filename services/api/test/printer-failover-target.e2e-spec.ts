import { OrderStatus } from "@prisma/client";
import {
  PrintJobStateMachine,
  PrismaService,
  reevaluatePrinterJobs,
} from "@print-automated/backend-shared";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

async function seedQueued(
  fx: Fx,
  printerId: string,
  status: "QUEUED" | "PRINTING" = "QUEUED",
): Promise<{ jobId: string; itemId: string }> {
  const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
  const job = await fx.prisma.printJob.create({
    data: {
      orderId,
      shopId: fx.shop.id,
      branchId: await branchIdOf(fx.prisma, fx.shop.id),
      orderItemId: itemIds[0]!,
      printerId,
      status,
      idempotencyToken: `${itemIds[0]}:1`,
    },
  });
  return { jobId: job.id, itemId: itemIds[0]! };
}

describe("Failover re-checks the TARGET printer under the lock (19.6, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    await clearOfUtcMidnight();
    fx = await createPhase19Fixture("fo-target", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  function run(
    printerId: string,
    afterCandidatesRead?: () => Promise<void>,
    trigger: "PRINTER_DISABLED" | "PAGE_LIMIT_REACHED" = "PRINTER_DISABLED",
  ) {
    // A variable (not an object literal) so the hook is passed even before the
    // type knows about it.
    const deps = {
      prisma: fx.app.get(PrismaService),
      jobMachine: fx.app.get(PrintJobStateMachine),
      afterCandidatesRead,
    };
    return reevaluatePrinterJobs(deps, {
      shopId: fx.shop.id,
      printerId,
      trigger,
    });
  }

  it("target disabled between the candidate read and the move: job ends WAITING/PRINTER_DISABLED, not QUEUED on the disabled printer", async () => {
    const a = await fx.makePrinter("T-A1");
    const b = await fx.makePrinter("T-B1");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    await fx.prisma.printer.update({ where: { id: a.printer.id }, data: { status: "DISABLED" } });
    const seeded = await seedQueued(fx, a.printer.id);

    await run(a.printer.id, async () => {
      await fx.prisma.printer.update({ where: { id: b.printer.id }, data: { status: "DISABLED" } });
    });

    const live = await fx.prisma.printJob.findMany({
      where: { orderItemId: seeded.itemId, supersededAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.status).toBe("WAITING");
    expect(live[0]?.printerId).toBeNull();
    expect(live[0]?.blockedReason).toBe("PRINTER_DISABLED");
  });

  it("target heartbeating ERROR in the window is refused as PRINTER_OFFLINE", async () => {
    const a = await fx.makePrinter("T-A2");
    const b = await fx.makePrinter("T-B2");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    const seeded = await seedQueued(fx, a.printer.id);
    await run(a.printer.id, async () => {
      await fx.prisma.printer.update({ where: { id: b.printer.id }, data: { status: "ERROR" } });
    });
    const live = await fx.prisma.printJob.findMany({
      where: { orderItemId: seeded.itemId, supersededAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.status).toBe("WAITING");
    expect(live[0]?.blockedReason).toBe("PRINTER_OFFLINE");
  });

  it("target at its page limit in the window is refused as PAGE_LIMIT_REACHED", async () => {
    const a = await fx.makePrinter("T-A3");
    const b = await fx.makePrinter("T-B3", { pageLimit: 5, pageLimitEnabled: true });
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    const seeded = await seedQueued(fx, a.printer.id);
    await run(a.printer.id, async () => {
      const now = new Date();
      await fx.prisma.printerPageUsage.create({
        data: {
          printerId: b.printer.id,
          periodStart: new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
          ),
          pagesUsed: 5,
        },
      });
    });
    const live = await fx.prisma.printJob.findMany({
      where: { orderItemId: seeded.itemId, supersededAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.status).toBe("WAITING");
    expect(live[0]?.blockedReason).toBe("PAGE_LIMIT_REACHED");
  });

  it("target still fine: the job moves", async () => {
    const a = await fx.makePrinter("T-A4");
    const b = await fx.makePrinter("T-B4");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    const seeded = await seedQueued(fx, a.printer.id);
    await run(a.printer.id, async () => undefined);
    const live = await fx.prisma.printJob.findMany({
      where: { orderItemId: seeded.itemId, supersededAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.printerId).toBe(b.printer.id);
    expect(live[0]?.status).toBe("QUEUED");
  });

  it("two printers that are each other's only alternative, both disabled at once: no live QUEUED job on a disabled printer, none with two live jobs", async () => {
    for (let round = 0; round < 4; round += 1) {
      const a = await fx.makePrinter(`T-PA${round}`);
      const b = await fx.makePrinter(`T-PB${round}`);
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
        data: { status: "DISABLED" },
      });
      const onA = [await seedQueued(fx, a.printer.id), await seedQueued(fx, a.printer.id)];
      const onB = [await seedQueued(fx, b.printer.id), await seedQueued(fx, b.printer.id)];
      const patch = (id: string) =>
        request(fx.app.getHttpServer())
          .patch(`/v1/shop/printers/${id}`)
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ enabled: false });
      const [ra, rb] = await Promise.all([patch(a.printer.id), patch(b.printer.id)]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      for (const s of [...onA, ...onB]) {
        const live = await fx.prisma.printJob.findMany({
          where: { orderItemId: s.itemId, supersededAt: null },
          include: { printer: true },
        });
        expect(live).toHaveLength(1);
        const printer = live[0]!.printer;
        if (live[0]!.status === "QUEUED") {
          expect(printer?.status).not.toBe("DISABLED");
        } else {
          expect(live[0]!.status).toBe("WAITING");
          expect(live[0]!.blockedReason).toBeTruthy();
        }
      }
    }
  });

  it("FORCED overlap: the accrual trigger fires inside the disable trigger's window; the outer run skips what the nested run already moved (one live job per item, usage 10)", async () => {
    const a = await fx.makePrinter("O-A", { pageLimit: 10, pageLimitEnabled: true });
    const b = await fx.makePrinter("O-B");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    const now = new Date();
    await fx.prisma.printerPageUsage.create({
      data: {
        printerId: a.printer.id,
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        pagesUsed: 5,
      },
    });
    await fx.prisma.printer.update({ where: { id: a.printer.id }, data: { status: "DISABLED" } });
    const printing = await seedQueued(fx, a.printer.id, "PRINTING");
    const queued = [await seedQueued(fx, a.printer.id), await seedQueued(fx, a.printer.id)];

    let fired = false;
    const result = await run(a.printer.id, async () => {
      if (fired) return;
      fired = true;
      // The agent's PRINTED report lands while the disable trigger holds its
      // (now stale) list of A's queued jobs. Its own limit trigger runs to
      // completion right here.
      await fx.app
        .get(AgentJobsService)
        .reportStatus(printing.jobId, a.deviceId, { status: "PRINTED" });
    });

    expect(
      (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: printing.jobId } })).status,
    ).toBe("PRINTED");
    const usage = await fx.prisma.printerPageUsage.findFirstOrThrow({
      where: { printerId: a.printer.id },
    });
    expect(usage.pagesUsed).toBe(10);
    for (const q of queued) {
      const live = await fx.prisma.printJob.findMany({
        where: { orderItemId: q.itemId, supersededAt: null },
      });
      expect(live).toHaveLength(1);
      expect(live[0]?.printerId).toBe(b.printer.id);
      expect(live[0]?.status).toBe("QUEUED");
    }
    // PROOF the interleaving really happened: the nested limit trigger moved
    // both jobs first, so the outer disable run found them already gone.
    expect(result.outcomes.map((o) => o.action)).toEqual(["SKIPPED", "SKIPPED"]);
  });

  it("FORCED contention: each printer becomes disabled inside the OTHER's window; outcome consistent with the window", async () => {
    const a = await fx.makePrinter("F-A");
    const b = await fx.makePrinter("F-B");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    await fx.prisma.printer.update({ where: { id: a.printer.id }, data: { status: "DISABLED" } });
    const onA = [await seedQueued(fx, a.printer.id), await seedQueued(fx, a.printer.id)];
    const onB = [await seedQueued(fx, b.printer.id), await seedQueued(fx, b.printer.id)];

    let fired = false;
    const outerA = await run(a.printer.id, async () => {
      if (fired) return;
      fired = true;
      // Inside A's window: B is disabled and B's own trigger runs to
      // completion (it sees A already disabled, so B's jobs have nowhere to go).
      await fx.prisma.printer.update({ where: { id: b.printer.id }, data: { status: "DISABLED" } });
      await run(b.printer.id);
    });

    for (const s of [...onA, ...onB]) {
      const live = await fx.prisma.printJob.findMany({
        where: { orderItemId: s.itemId, supersededAt: null },
        include: { printer: true },
      });
      expect(live).toHaveLength(1);
      // Both printers are disabled, so NOTHING may be QUEUED anywhere: every
      // job is parked WAITING with the reason the window produced.
      expect(live[0]?.status).toBe("WAITING");
      expect(live[0]?.printerId).toBeNull();
      expect(live[0]?.blockedReason).toBe("PRINTER_DISABLED");
    }
    // A's first job targeted the (stale) B and was parked by the target
    // re-check; none of A's jobs was MOVED.
    expect(outerA.outcomes.every((o) => o.action === "BLOCKED")).toBe(true);
    expect(outerA.outcomes).toHaveLength(2);
  });
});
