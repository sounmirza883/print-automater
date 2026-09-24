import { Logger } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import {
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  reevaluatePrinterJobs,
} from "@print-automated/backend-shared";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";

type Machine = PrintJobStateMachine;

async function seed(
  fx: Fx,
  printerId: string,
  status: "QUEUED" | "PRINTING" = "QUEUED",
): Promise<{ jobId: string; itemId: string; orderId: string }> {
  const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
  const job = await fx.prisma.printJob.create({
    data: {
      orderId,
      shopId: fx.shop.id,
      orderItemId: itemIds[0]!,
      printerId,
      status,
      idempotencyToken: `${itemIds[0]}:1`,
    },
  });
  return { jobId: job.id, itemId: itemIds[0]!, orderId };
}

function park(fx: Fx, keep: string[]) {
  return fx.prisma.printer.updateMany({
    where: { shopId: fx.shop.id, id: { notIn: keep } },
    data: { status: "DISABLED" },
  });
}

describe("Failover hardening (19.11, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    await clearOfUtcMidnight();
    fx = await createPhase19Fixture("fo-harden", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await fx?.cleanup();
  });

  function deps(jobMachine: Machine, afterCandidatesRead?: () => Promise<void>) {
    return { prisma: fx.app.get(PrismaService), jobMachine, afterCandidatesRead };
  }

  it("(a) a poison job cannot block the rest: job 2 is still re-evaluated and the error is reported", async () => {
    const a = await fx.makePrinter("P-A");
    await park(fx, [a.printer.id]);
    await fx.prisma.printer.update({ where: { id: a.printer.id }, data: { status: "DISABLED" } });
    const j1 = await seed(fx, a.printer.id);
    const j2 = await seed(fx, a.printer.id);
    const real = fx.app.get(PrintJobStateMachine);
    const poisoned = {
      transition: async (
        id: string,
        event: PrintJobEvent,
        actor: { id: string | null },
        ctx: never,
      ) => {
        if (id === j1.jobId && event === PrintJobEvent.UNALLOCATE) {
          throw new Error("poison job");
        }
        return real.transition(id, event, actor, ctx);
      },
    } as unknown as Machine;

    const result = await reevaluatePrinterJobs(deps(poisoned), {
      shopId: fx.shop.id,
      printerId: a.printer.id,
      trigger: "PRINTER_DISABLED",
    });

    const second = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: j2.jobId } });
    expect(second.status).toBe("WAITING");
    expect(second.blockedReason).toBe("PRINTER_DISABLED");
    const first = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: j1.jobId } });
    expect(first.status).toBe("QUEUED");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ jobId: j1.jobId });
    expect(String(result.errors[0]?.error)).toContain("poison job");
  });

  it("(c) stale-target UNALLOCATE: full rollback of the failed move, audit rows for BOTH paths with actor null", async () => {
    const a = await fx.makePrinter("S-A");
    const b = await fx.makePrinter("S-B");
    await park(fx, [a.printer.id, b.printer.id]);
    await fx.prisma.printer.update({ where: { id: a.printer.id }, data: { status: "DISABLED" } });
    const stale = await seed(fx, a.printer.id);
    const real = fx.app.get(PrintJobStateMachine);
    let snapshot: unknown;
    const observing = {
      transition: async (
        id: string,
        event: PrintJobEvent,
        actor: { id: string | null },
        ctx: never,
      ) => {
        if (id === stale.jobId && event === PrintJobEvent.UNALLOCATE) {
          // Between the failed SUPERSEDE and the UNALLOCATE: the guard threw
          // FAILOVER_TARGET_STALE, so NOTHING of the supersede may remain.
          const rows = await fx.prisma.printJob.findMany({ where: { orderItemId: stale.itemId } });
          snapshot = rows.map((r) => [r.id, r.status, r.printerId, r.supersededAt]);
        }
        return real.transition(id, event, actor, ctx);
      },
    } as unknown as Machine;

    let fired = false;
    await reevaluatePrinterJobs(
      deps(observing, async () => {
        if (fired) return;
        fired = true;
        await fx.prisma.printer.update({
          where: { id: b.printer.id },
          data: { status: "DISABLED" },
        });
      }),
      { shopId: fx.shop.id, printerId: a.printer.id, trigger: "PRINTER_DISABLED" },
    );

    // Exactly the original row, untouched: still QUEUED on A, not superseded,
    // no successor row.
    expect(snapshot).toEqual([[stale.jobId, "QUEUED", a.printer.id, null]]);
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceId: stale.jobId, action: "PRINT_JOB_UNALLOCATE" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBeNull();
    expect(audit?.metadata).toMatchObject({
      automatic: true,
      staleTargetId: b.printer.id,
      staleReason: "PRINTER_DISABLED",
      fromPrinterId: a.printer.id,
    });
    // No SUPERSEDE audit for it (the move never committed).
    expect(
      await fx.prisma.auditLog.count({
        where: { resourceId: stale.jobId, action: "PRINT_JOB_SUPERSEDE" },
      }),
    ).toBe(0);

    // And the SUCCESS path is audited with actor null too.
    const c = await fx.makePrinter("S-C");
    const d = await fx.makePrinter("S-D");
    await park(fx, [c.printer.id, d.printer.id]);
    await fx.prisma.printer.update({ where: { id: c.printer.id }, data: { status: "DISABLED" } });
    const ok = await seed(fx, c.printer.id);
    await reevaluatePrinterJobs(deps(real), {
      shopId: fx.shop.id,
      printerId: c.printer.id,
      trigger: "PRINTER_DISABLED",
    });
    const moved = await fx.prisma.auditLog.findFirst({
      where: { resourceId: ok.jobId, action: "PRINT_JOB_SUPERSEDE" },
    });
    expect(moved?.actorId).toBeNull();
    expect(moved?.metadata).toMatchObject({ automatic: true, toPrinterId: d.printer.id });
  });

  it("(d) claimedAt and supersededAt use the injected clock", async () => {
    const a = await fx.makePrinter("K-A");
    const b = await fx.makePrinter("K-B");
    const machine = fx.app.get(PrintJobStateMachine);
    const fake = new Date("2031-05-05T05:05:05.000Z");

    const claim = await seed(fx, a.printer.id);
    await machine.transition(
      claim.jobId,
      PrintJobEvent.CLAIM,
      { id: null },
      {
        syncOrder: false,
        now: fake,
      },
    );
    expect(
      (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: claim.jobId } })).claimedAt,
    ).toEqual(fake);

    const sup = await seed(fx, a.printer.id);
    await machine.transition(
      sup.jobId,
      PrintJobEvent.SUPERSEDE,
      { id: null },
      {
        successor: { printerId: b.printer.id },
        now: fake,
      },
    );
    expect(
      (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: sup.jobId } })).supersededAt,
    ).toEqual(fake);
  });

  it("(b) job-pages fallbacks are reported (warn, metric tag) without changing the count", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const machine = fx.app.get(PrintJobStateMachine);

    // Unknown document page count: counts as 1.
    const unknown = await createPhase19Fixture("fo-harden-null", {
      multiItemEnabled: true,
      documentPages: null,
    });
    try {
      const p = await unknown.makePrinter("U-A");
      const { orderId, itemIds } = await unknown.makeOrder(1, 2, OrderStatus.QUEUED_FOR_PRINT);
      const job = await unknown.prisma.printJob.create({
        data: {
          orderId,
          shopId: unknown.shop.id,
          orderItemId: itemIds[0]!,
          printerId: p.printer.id,
          status: "PRINTING",
          idempotencyToken: `${itemIds[0]}:1`,
        },
      });
      await machine.transition(job.id, PrintJobEvent.PRINTED, { id: null });
      const usage = await unknown.prisma.printerPageUsage.findFirstOrThrow({
        where: { printerId: p.printer.id },
      });
      expect(usage.pagesUsed).toBe(2); // 1 page x 2 copies, unchanged behaviour
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: "job_pages.fallback",
          reason: "UNKNOWN_DOCUMENT_PAGE_COUNT",
          jobId: job.id,
          orderId,
        }),
        expect.any(String),
      );
    } finally {
      await unknown.cleanup();
    }

    warn.mockClear();
    // Range the resolver rejects: whole document (5 pages) x 1.
    const p2 = await fx.makePrinter("U-B");
    const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, {
      pages: { mode: "range", from: 1, to: 999 },
      copies: 1,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    });
    const job2 = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId: p2.printer.id,
        status: "PRINTING",
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    await machine.transition(job2.id, PrintJobEvent.PRINTED, { id: null });
    const usage2 = await fx.prisma.printerPageUsage.findFirstOrThrow({
      where: { printerId: p2.printer.id },
    });
    expect(usage2.pagesUsed).toBe(5);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ metric: "job_pages.fallback", reason: "INVALID_PAGE_RANGE" }),
      expect.any(String),
    );
  });
});
