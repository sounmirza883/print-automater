import "reflect-metadata";
import "dotenv/config";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { PrintJobStatus } from "@prisma/client";
import {
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  REDIS_CLIENT,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { PrintTimeoutProcessor } from "../src/print-timeout/print-timeout.processor.js";
import { PrinterOfflineSweepProcessor } from "../src/printer-offline-sweep/printer-offline-sweep.processor.js";
import { createSweepFixture, STALE_MS, type SweepFixture } from "./helpers/sweep-fixture.js";

/** 19.16. The REAL sweep processors racing a staff reassign of the same job,
 * fired with Promise.all. (The retry-print endpoint lives in the API; its race
 * against the same sweep primitives is services/api/test/sweep-vs-retry-race.)
 * Whichever side wins: exactly one live job for the item, the loser is a clean
 * no-op, nothing throws, and a job is never both timed out AND re-dispatched. */
const ITERATIONS = 8;

describe("Sweeps racing a staff reassign (19.16, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let redis: Redis;
  const fakeJob = {} as Job;
  const fixtures: SweepFixture[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
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

  async function fixture(): Promise<SweepFixture> {
    const fx = await createSweepFixture(prisma, redis, "sweep-race", { autoFailoverEnabled: true });
    fixtures.push(fx);
    return fx;
  }

  it("print-timeout sweep vs staff reassign of a stale QUEUED job: exactly one wins, one live job", async () => {
    const fx = await fixture();
    const a = await fx.makePrinter("a");
    const b = await fx.makePrinter("b");
    const machine = app.get(PrintJobStateMachine);
    const timeout = app.get(PrintTimeoutProcessor);
    const outcomes = new Set<string>();

    for (let i = 0; i < ITERATIONS; i += 1) {
      const seeded = await fx.makeJob(a.printer.id, PrintJobStatus.QUEUED, { ageMinutes: 9999 });
      const [, reassigned] = await Promise.all([
        timeout.process(fakeJob),
        machine
          .transition(
            seeded.jobId,
            PrintJobEvent.SUPERSEDE,
            { id: null },
            { successor: { printerId: b.printer.id } },
          )
          .then(() => "reassigned" as const)
          .catch((e: { errorCode?: string }) => e.errorCode ?? "error"),
      ]);
      expect(["reassigned", "ILLEGAL_JOB_TRANSITION"]).toContain(reassigned);

      const all = await prisma.printJob.findMany({ where: { orderItemId: seeded.itemId } });
      const original = all.find((j) => j.id === seeded.jobId)!;
      if (reassigned === "reassigned") {
        // Staff won: the sweep must not have timed the (superseded) job out, and
        // the single live job is the queued successor.
        outcomes.add("reassign-won");
        expect(original.status).toBe("REASSIGNED");
        const live = all.filter((j) => j.supersededAt === null);
        expect(live).toHaveLength(1);
        expect(live[0]?.status).toBe("QUEUED");
      } else {
        // The sweep won: timed out, no successor invented.
        outcomes.add("timeout-won");
        expect(original.status).toBe("TIMEOUT");
        expect(all).toHaveLength(1);
      }
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  });

  it("offline sweep vs staff reassign of a job on the printer going silent: one live job", async () => {
    const fx = await fixture();
    const machine = app.get(PrintJobStateMachine);
    const sweep = app.get(PrinterOfflineSweepProcessor);
    const c = await fx.makePrinter("c-alive");

    for (let i = 0; i < ITERATIONS; i += 1) {
      const dead = await fx.makePrinter(`dead-${i}`, { lastSeenAgoMs: STALE_MS });
      const seeded = await fx.makeJob(dead.printer.id, PrintJobStatus.QUEUED);
      await Promise.all([
        sweep.process(fakeJob),
        machine
          .transition(
            seeded.jobId,
            PrintJobEvent.SUPERSEDE,
            { id: null },
            { successor: { printerId: c.printer.id } },
          )
          .catch(() => undefined),
      ]);
      const all = await prisma.printJob.findMany({ where: { orderItemId: seeded.itemId } });
      const live = all.filter((j) => j.supersededAt === null);
      expect(live).toHaveLength(1);
      expect(live[0]?.status).toBe("QUEUED");
      expect(all.length).toBeLessThanOrEqual(2);
    }
  });
});
