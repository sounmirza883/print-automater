import "reflect-metadata";
import "dotenv/config";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { PrintJobStatus, PrinterStatus } from "@prisma/client";
import {
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  REDIS_CLIENT,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { PrinterOfflineSweepProcessor } from "../src/printer-offline-sweep/printer-offline-sweep.processor.js";
import {
  createSweepFixture,
  STALE_MS,
  waitForNotificationsDrained,
  type SweepFixture,
} from "./helpers/sweep-fixture.js";

/** 19.15. A job parked WAITING because printers were unavailable (offline,
 * disabled, at their page limit) is re-allocated once one qualifies again,
 * only for shops that opted in, and only for availability-type reasons: a job
 * blocked for a capability/paper/operator/approval reason needs a human or a
 * different change, not just "a printer came back". */
describe("Queue recovery: WAITING jobs re-allocate when capacity returns (19.15, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let redis: Redis;
  let processor: PrinterOfflineSweepProcessor;
  const fakeJob = {} as Job;
  const fixtures: SweepFixture[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
    processor = app.get(PrinterOfflineSweepProcessor);
  });
  afterAll(async () => {
    const errors: unknown[] = [];
    for (const fx of fixtures) {
      await fx.cleanup().catch((e: unknown) => errors.push(e));
    }
    await waitForNotificationsDrained(redis);
    await app.close();
    if (errors.length > 0) {
      throw new AggregateError(errors, "cleanup failed");
    }
  });

  async function fixture(flag: boolean): Promise<SweepFixture> {
    const fx = await createSweepFixture(prisma, redis, "recovery", { autoFailoverEnabled: flag });
    fixtures.push(fx);
    return fx;
  }
  const job = (id: string) => prisma.printJob.findUniqueOrThrow({ where: { id } });
  const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

  it("flag ON: a job blocked PRINTER_OFFLINE is queued on a printer that is online again, its blocked reason is cleared, the order re-derives and the agent is woken", async () => {
    const fx = await fixture(true);
    const p = await fx.makePrinter("back");
    const seeded = await fx.makeJob(null, PrintJobStatus.WAITING, {
      blockedReason: "PRINTER_OFFLINE",
      orderStatus: "PREPARING",
    });

    await processor.process(fakeJob);

    expect(await job(seeded.jobId)).toMatchObject({
      status: "QUEUED",
      printerId: p.printer.id,
      blockedReason: null,
    });
    expect((await order(seeded.orderId)).orderStatus).toBe("QUEUED_FOR_PRINT");
    expect(await fx.signalLength(p.deviceId)).toBe(1);
    const audit = await prisma.auditLog.findMany({
      where: { resourceId: seeded.jobId, action: "PRINT_JOB_ALLOCATE" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ automatic: true, trigger: "PRINTER_RECOVERED" });
  });

  it("flag OFF: the same WAITING job is left for staff (automation is opt-in)", async () => {
    const fx = await fixture(false);
    const p = await fx.makePrinter("back");
    const seeded = await fx.makeJob(null, PrintJobStatus.WAITING, {
      blockedReason: "PRINTER_OFFLINE",
      orderStatus: "PREPARING",
    });

    await processor.process(fakeJob);

    expect(await job(seeded.jobId)).toMatchObject({ status: "WAITING", printerId: null });
    expect(await fx.signalLength(p.deviceId)).toBe(0);
  });

  it("only availability reasons recover: NO_COMPATIBLE_PRINTER, NO_PAPER, OPERATOR_UNAVAILABLE and MANUAL_APPROVAL_REQUIRED stay parked", async () => {
    const fx = await fixture(true);
    await fx.makePrinter("back");
    const parked = [] as string[];
    for (const reason of [
      "NO_COMPATIBLE_PRINTER",
      "NO_PAPER",
      "OPERATOR_UNAVAILABLE",
      "MANUAL_APPROVAL_REQUIRED",
    ]) {
      parked.push(
        (
          await fx.makeJob(null, PrintJobStatus.WAITING, {
            blockedReason: reason,
            orderStatus: "PREPARING",
          })
        ).jobId,
      );
    }
    const recoverable = [] as string[];
    for (const reason of ["PRINTER_DISABLED", "PAGE_LIMIT_REACHED"]) {
      recoverable.push(
        (
          await fx.makeJob(null, PrintJobStatus.WAITING, {
            blockedReason: reason,
            orderStatus: "PREPARING",
          })
        ).jobId,
      );
    }

    await processor.process(fakeJob);

    for (const id of parked) {
      expect(await job(id)).toMatchObject({ status: "WAITING", printerId: null });
    }
    for (const id of recoverable) {
      expect((await job(id)).status).toBe("QUEUED");
    }
  });

  it("stays WAITING while no printer qualifies (offline / disabled)", async () => {
    const fx = await fixture(true);
    await fx.makePrinter("off", { status: PrinterStatus.OFFLINE });
    await fx.makePrinter("disabled", { status: PrinterStatus.DISABLED });
    const seeded = await fx.makeJob(null, PrintJobStatus.WAITING, {
      blockedReason: "PRINTER_OFFLINE",
      orderStatus: "PREPARING",
    });

    await processor.process(fakeJob);

    expect(await job(seeded.jobId)).toMatchObject({ status: "WAITING", printerId: null });
  });

  it("full journey: the only printer goes silent (job parks WAITING), the agent comes back, the next tick re-queues the SAME job -- no duplicate job", async () => {
    const fx = await fixture(true);
    const p = await fx.makePrinter("solo", { lastSeenAgoMs: STALE_MS });
    const seeded = await fx.makeJob(p.printer.id, PrintJobStatus.QUEUED);

    await processor.process(fakeJob);
    expect(await job(seeded.jobId)).toMatchObject({
      status: "WAITING",
      blockedReason: "PRINTER_OFFLINE",
    });

    // The agent's heartbeat: fresh lastSeen and its printer reports ONLINE.
    await prisma.printerAgent.update({
      where: { id: p.agentId },
      data: { lastSeenAt: new Date() },
    });
    await prisma.printer.update({ where: { id: p.printer.id }, data: { status: "ONLINE" } });

    await processor.process(fakeJob);

    expect(await job(seeded.jobId)).toMatchObject({
      status: "QUEUED",
      printerId: p.printer.id,
      blockedReason: null,
    });
    expect(await prisma.printJob.count({ where: { orderItemId: seeded.itemId } })).toBe(1);
    expect(await fx.signalLength(p.deviceId)).toBeGreaterThanOrEqual(1);
  });

  it("two recovery ticks racing (Promise.all) allocate the job exactly once", async () => {
    const fx = await fixture(true);
    await fx.makePrinter("a");
    await fx.makePrinter("b");
    const jobs = [] as string[];
    for (let i = 0; i < 4; i += 1) {
      jobs.push(
        (
          await fx.makeJob(null, PrintJobStatus.WAITING, {
            blockedReason: "PRINTER_OFFLINE",
            orderStatus: "PREPARING",
          })
        ).jobId,
      );
    }

    await Promise.all([processor.process(fakeJob), processor.process(fakeJob)]);

    for (const id of jobs) {
      expect((await job(id)).status).toBe("QUEUED");
      const audits = await prisma.auditLog.count({
        where: { resourceId: id, action: "PRINT_JOB_ALLOCATE" },
      });
      expect(audits).toBe(1);
    }
  });

  it("recovery racing a staff reassign of the same WAITING job (Promise.all) never leaves two live jobs", async () => {
    const fx = await fixture(true);
    const a = await fx.makePrinter("a");
    const b = await fx.makePrinter("b");
    const machine = app.get(PrintJobStateMachine);

    for (let i = 0; i < 6; i += 1) {
      const seeded = await fx.makeJob(null, PrintJobStatus.WAITING, {
        blockedReason: "PRINTER_OFFLINE",
        orderStatus: "PREPARING",
      });
      await Promise.all([
        processor.process(fakeJob),
        // Staff reassigns the parked job (PrintJobsService.reassign's own
        // core: SUPERSEDE with an in-transaction successor).
        machine
          .transition(
            seeded.jobId,
            PrintJobEvent.SUPERSEDE,
            { id: null },
            { successor: { printerId: i % 2 === 0 ? a.printer.id : b.printer.id } },
          )
          .catch(() => undefined),
      ]);

      const live = await prisma.printJob.findMany({
        where: { orderItemId: seeded.itemId, supersededAt: null },
      });
      expect(live).toHaveLength(1);
      expect(live[0]?.status).toBe("QUEUED");
      const all = await prisma.printJob.count({ where: { orderItemId: seeded.itemId } });
      expect(all).toBeLessThanOrEqual(2);
    }
  });
});
