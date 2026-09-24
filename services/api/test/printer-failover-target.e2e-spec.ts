import { OrderStatus } from "@prisma/client";
import {
  PrintJobStateMachine,
  PrismaService,
  reevaluatePrinterJobs,
} from "@print-automated/backend-shared";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

async function seedQueued(fx: Fx, printerId: string): Promise<{ jobId: string; itemId: string }> {
  const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
  const job = await fx.prisma.printJob.create({
    data: {
      orderId,
      shopId: fx.shop.id,
      orderItemId: itemIds[0]!,
      printerId,
      status: "QUEUED",
      idempotencyToken: `${itemIds[0]}:1`,
    },
  });
  return { jobId: job.id, itemId: itemIds[0]! };
}

describe("Failover re-checks the TARGET printer under the lock (19.6, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("fo-target", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx.cleanup();
  });

  function run(printerId: string, afterCandidatesRead?: () => Promise<void>) {
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
      trigger: "PRINTER_DISABLED",
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
});
