import "reflect-metadata";
import "dotenv/config";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { PrintJobStatus, PrinterStatus } from "@prisma/client";
import { PrismaService, REDIS_CLIENT } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { PrinterOfflineSweepProcessor } from "../src/printer-offline-sweep/printer-offline-sweep.processor.js";
import { createSweepFixture, STALE_MS, type SweepFixture } from "./helpers/sweep-fixture.js";

/** 19.14 (PRD 25/122). The offline sweep learns WHICH printers it just flipped
 * (UPDATE .. RETURNING), and only for shops that opted in (auto_failover_enabled)
 * hands their still-QUEUED jobs to another printer and wakes that agent. */
describe("Printer offline sweep failover (19.14, e2e)", () => {
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
    await app.close();
    if (errors.length > 0) {
      throw new AggregateError(errors, "cleanup failed");
    }
  });

  async function fixture(flag: boolean): Promise<SweepFixture> {
    const fx = await createSweepFixture(prisma, redis, "off-failover", {
      autoFailoverEnabled: flag,
    });
    fixtures.push(fx);
    return fx;
  }
  const job = (id: string) => prisma.printJob.findUniqueOrThrow({ where: { id } });
  const liveJobs = (itemId: string) =>
    prisma.printJob.findMany({ where: { orderItemId: itemId, supersededAt: null } });

  it("flag ON: a printer that just went silent hands its QUEUED job to the healthy printer and wakes that agent", async () => {
    const fx = await fixture(true);
    const dead = await fx.makePrinter("dead", { lastSeenAgoMs: STALE_MS });
    const alive = await fx.makePrinter("alive");
    const seeded = await fx.makeJob(dead.printer.id, PrintJobStatus.QUEUED);

    await processor.process(fakeJob);

    expect(
      (await prisma.printer.findUniqueOrThrow({ where: { id: dead.printer.id } })).status,
    ).toBe(PrinterStatus.OFFLINE);
    expect((await job(seeded.jobId)).status).toBe("REASSIGNED");
    const live = await liveJobs(seeded.itemId);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ status: "QUEUED", printerId: alive.printer.id });
    expect(await fx.signalLength(alive.deviceId)).toBe(1);
    expect(await fx.signalLength(dead.deviceId)).toBe(0);
  });

  it("flag OFF: the printer still goes OFFLINE but no job is touched and nobody is woken (automation is opt-in)", async () => {
    const fx = await fixture(false);
    const dead = await fx.makePrinter("dead", { lastSeenAgoMs: STALE_MS });
    const alive = await fx.makePrinter("alive");
    const seeded = await fx.makeJob(dead.printer.id, PrintJobStatus.QUEUED);

    await processor.process(fakeJob);

    expect(
      (await prisma.printer.findUniqueOrThrow({ where: { id: dead.printer.id } })).status,
    ).toBe(PrinterStatus.OFFLINE);
    expect(await job(seeded.jobId)).toMatchObject({
      status: "QUEUED",
      printerId: dead.printer.id,
    });
    expect(await liveJobs(seeded.itemId)).toHaveLength(1);
    expect(await fx.signalLength(alive.deviceId)).toBe(0);
  });

  it("flag ON but no other printer qualifies: the job parks as WAITING with PRINTER_OFFLINE", async () => {
    const fx = await fixture(true);
    const dead = await fx.makePrinter("dead", { lastSeenAgoMs: STALE_MS });
    const seeded = await fx.makeJob(dead.printer.id, PrintJobStatus.QUEUED);

    await processor.process(fakeJob);

    expect(await job(seeded.jobId)).toMatchObject({
      status: "WAITING",
      printerId: null,
      blockedReason: "PRINTER_OFFLINE",
    });
  });

  it("never moves a job an agent already claimed or is printing (it may be on paper)", async () => {
    const fx = await fixture(true);
    const dead = await fx.makePrinter("dead", { lastSeenAgoMs: STALE_MS });
    await fx.makePrinter("alive");
    const claimed = await fx.makeJob(dead.printer.id, PrintJobStatus.CLAIMED);
    const printing = await fx.makeJob(dead.printer.id, PrintJobStatus.PRINTING);

    await processor.process(fakeJob);

    expect((await job(claimed.jobId)).status).toBe("CLAIMED");
    expect((await job(printing.jobId)).status).toBe("PRINTING");
    expect(await liveJobs(claimed.itemId)).toHaveLength(1);
    expect(await liveJobs(printing.itemId)).toHaveLength(1);
  });

  it("only printers THIS tick flipped trigger failover: a printer that was already OFFLINE is left alone", async () => {
    const fx = await fixture(true);
    const already = await fx.makePrinter("already-off", {
      lastSeenAgoMs: STALE_MS,
      status: PrinterStatus.OFFLINE,
    });
    await fx.makePrinter("alive");
    const seeded = await fx.makeJob(already.printer.id, PrintJobStatus.QUEUED);

    await processor.process(fakeJob);

    expect(await job(seeded.jobId)).toMatchObject({
      status: "QUEUED",
      printerId: already.printer.id,
    });
  });

  it("two sweeps racing (Promise.all) on one silent printer produce exactly ONE successor per job", async () => {
    const fx = await fixture(true);
    const dead = await fx.makePrinter("dead", { lastSeenAgoMs: STALE_MS });
    await fx.makePrinter("alive");
    const seeded = await fx.makeJob(dead.printer.id, PrintJobStatus.QUEUED);
    const other = await fx.makeJob(dead.printer.id, PrintJobStatus.QUEUED);

    await Promise.all([processor.process(fakeJob), processor.process(fakeJob)]);

    for (const s of [seeded, other]) {
      const all = await prisma.printJob.findMany({ where: { orderItemId: s.itemId } });
      expect(all).toHaveLength(2);
      const live = all.filter((j) => j.supersededAt === null);
      expect(live).toHaveLength(1);
      expect(live[0]?.status).toBe("QUEUED");
    }
  });
});
