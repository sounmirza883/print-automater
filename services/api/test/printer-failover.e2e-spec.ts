import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { AgentHeartbeatService } from "../src/agents/agent-heartbeat.service.js";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";

type JobStatus = "QUEUED" | "CLAIMED" | "PRINTING";

async function seedJobs(
  fx: Fx,
  printerId: string,
  statuses: JobStatus[],
): Promise<Array<{ jobId: string; itemId: string; orderId: string }>> {
  const out: Array<{ jobId: string; itemId: string; orderId: string }> = [];
  for (const status of statuses) {
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
    out.push({ jobId: job.id, itemId: itemIds[0]!, orderId });
  }
  return out;
}

function liveJobs(fx: Fx, itemId: string) {
  return fx.prisma.printJob.findMany({ where: { orderItemId: itemId, supersededAt: null } });
}

function disable(fx: Fx, printerId: string) {
  return request(fx.app.getHttpServer())
    .patch(`/v1/shop/printers/${printerId}`)
    .set("Authorization", `Bearer ${fx.token}`)
    .send({ enabled: false });
}

describe("Automatic printer failover (19.4, e2e)", () => {
  describe("flag ON", () => {
    let fx: Fx;
    beforeAll(async () => {
      fx = await createPhase19Fixture("fo-on", {
        multiItemEnabled: true,
        autoFailoverEnabled: true,
      });
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    it("disabling a printer moves both QUEUED jobs to the other printer: one live job per item, audited, new agent woken, old agent refused", async () => {
      const a = await fx.makePrinter("A");
      const b = await fx.makePrinter("B");
      const seeded = await seedJobs(fx, a.printer.id, ["QUEUED", "QUEUED"]);

      await disable(fx, a.printer.id).expect(200);

      for (const s of seeded) {
        const live = await liveJobs(fx, s.itemId);
        expect(live).toHaveLength(1);
        expect(live[0]?.printerId).toBe(b.printer.id);
        expect(live[0]?.status).toBe("QUEUED");
        const old = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: s.jobId } });
        expect(old.status).toBe("REASSIGNED");
        const audit = await fx.prisma.auditLog.findFirst({
          where: { resourceId: s.jobId, action: "PRINT_JOB_SUPERSEDE" },
        });
        expect(audit?.actorId).toBeNull();
        expect(audit?.metadata).toMatchObject({
          automatic: true,
          trigger: "PRINTER_DISABLED",
          fromPrinterId: a.printer.id,
          toPrinterId: b.printer.id,
        });
      }

      const jobs = fx.app.get(AgentJobsService);
      // The old agent's claim of a job that was just reassigned is refused.
      const refused = (await jobs
        .claim(seeded[0]!.jobId, a.deviceId)
        .catch((error: unknown) => error)) as { getStatus?: () => number };
      expect([404, 409]).toContain(refused.getStatus?.());
      // The new agent receives it.
      const offered = await jobs.waitForJob(b.deviceId, 1);
      expect(offered?.printerId).toBe(b.printer.id);
    });

    it("no other suitable printer: jobs are WAITING with a visible reason, none lost", async () => {
      const a = await fx.makePrinter("Solo A");
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id, id: { not: a.printer.id } },
        data: { status: "DISABLED" },
      });
      const seeded = await seedJobs(fx, a.printer.id, ["QUEUED", "QUEUED"]);
      await disable(fx, a.printer.id).expect(200);
      for (const s of seeded) {
        const live = await liveJobs(fx, s.itemId);
        expect(live).toHaveLength(1);
        expect(live[0]?.id).toBe(s.jobId);
        expect(live[0]?.status).toBe("WAITING");
        expect(live[0]?.printerId).toBeNull();
        expect(live[0]?.blockedReason).toBe("PRINTER_DISABLED");
      }
    });
  });

  describe("claimed jobs and other triggers", () => {
    let fx: Fx;
    beforeAll(async () => {
      await clearOfUtcMidnight();
      fx = await createPhase19Fixture("fo-trig", {
        multiItemEnabled: true,
        autoFailoverEnabled: true,
        documentPages: 5,
      });
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    it("a CLAIMED and a PRINTING job on the disabled printer are untouched; the QUEUED one moves", async () => {
      const a = await fx.makePrinter("A1");
      const b = await fx.makePrinter("B1");
      const [claimed, printing, queued] = await seedJobs(fx, a.printer.id, [
        "CLAIMED",
        "PRINTING",
        "QUEUED",
      ]);
      await disable(fx, a.printer.id).expect(200);
      const c = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: claimed!.jobId } });
      const p = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: printing!.jobId } });
      expect([c.status, c.printerId, c.supersededAt]).toEqual(["CLAIMED", a.printer.id, null]);
      expect([p.status, p.printerId, p.supersededAt]).toEqual(["PRINTING", a.printer.id, null]);
      const live = await liveJobs(fx, queued!.itemId);
      expect(live.map((j) => j.printerId)).toEqual([b.printer.id]);
    });

    it("usage reaching the limit re-evaluates the remaining queued jobs", async () => {
      const a = await fx.makePrinter("A2", { pageLimit: 10, pageLimitEnabled: true });
      const b = await fx.makePrinter("B2");
      // Only A and B compete: park everything else (earlier tests' printers).
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
        data: { status: "DISABLED" },
      });
      const now = new Date();
      await fx.prisma.printerPageUsage.create({
        data: {
          printerId: a.printer.id,
          periodStart: new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
          ),
          pagesUsed: 5,
        },
      });
      const [printing, q1, q2] = await seedJobs(fx, a.printer.id, ["PRINTING", "QUEUED", "QUEUED"]);
      await fx.app
        .get(AgentJobsService)
        .reportStatus(printing!.jobId, a.deviceId, { status: "PRINTED" });
      for (const q of [q1!, q2!]) {
        const live = await liveJobs(fx, q.itemId);
        expect(live).toHaveLength(1);
        expect(live[0]?.printerId).toBe(b.printer.id);
      }
    });

    it("a heartbeat reporting ERROR re-evaluates the printer's queued jobs", async () => {
      const a = await fx.makePrinter("A3");
      const b = await fx.makePrinter("B3");
      // Only A and B compete: park everything else (earlier tests' printers).
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
        data: { status: "DISABLED" },
      });
      const [q] = await seedJobs(fx, a.printer.id, ["QUEUED"]);
      await fx.app.get(AgentHeartbeatService).processHeartbeat(a.deviceId, fx.shop.id, {
        printers: [{ name: "A3", status: "ERROR" }],
      });
      const live = await liveJobs(fx, q!.itemId);
      expect(live).toHaveLength(1);
      expect(live[0]?.printerId).toBe(b.printer.id);
    });

    it("two triggers started together (disable + accrual): printing job PRINTED, usage 10, exactly one live job per queued item", async () => {
      for (let round = 0; round < 6; round += 1) {
        const a = await fx.makePrinter(`A4-${round}`, { pageLimit: 10, pageLimitEnabled: true });
        const b = await fx.makePrinter(`B4-${round}`);
        const now = new Date();
        await fx.prisma.printerPageUsage.create({
          data: {
            printerId: a.printer.id,
            periodStart: new Date(
              Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
            ),
            pagesUsed: 5,
          },
        });
        // Only A and B compete: park everything else.
        await fx.prisma.printer.updateMany({
          where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
          data: { status: "DISABLED" },
        });
        const [printing, q1, q2] = await seedJobs(fx, a.printer.id, [
          "PRINTING",
          "QUEUED",
          "QUEUED",
        ]);
        // Thunks: supertest only sends on `.then`, so both are STARTED here,
        // together, rather than one being eagerly finished first.
        const starters = [
          async () => await disable(fx, a.printer.id),
          async () =>
            await fx.app.get(AgentJobsService).reportStatus(printing!.jobId, a.deviceId, {
              status: "PRINTED",
            }),
        ];
        const [res] = await Promise.all(starters.map((start) => start()));
        expect((res as { status: number }).status).toBe(200);
        expect(
          (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: printing!.jobId } })).status,
        ).toBe("PRINTED");
        expect(
          (
            await fx.prisma.printerPageUsage.findFirstOrThrow({
              where: { printerId: a.printer.id },
            })
          ).pagesUsed,
        ).toBe(10);
        for (const q of [q1!, q2!]) {
          const live = await liveJobs(fx, q.itemId);
          expect(live).toHaveLength(1);
          expect(live[0]?.printerId).toBe(b.printer.id);
          expect(live[0]?.status).toBe("QUEUED");
        }
      }
    });
  });

  describe("flag OFF", () => {
    let fx: Fx;
    beforeAll(async () => {
      fx = await createPhase19Fixture("fo-off", {
        multiItemEnabled: true,
        autoFailoverEnabled: false,
      });
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    it("nothing moves when a printer is disabled or reports ERROR", async () => {
      const a = await fx.makePrinter("A5");
      await fx.makePrinter("B5");
      const c = await fx.makePrinter("C5");
      const [q1, q2] = await seedJobs(fx, a.printer.id, ["QUEUED", "QUEUED"]);
      const [q3] = await seedJobs(fx, c.printer.id, ["QUEUED"]);
      await disable(fx, a.printer.id).expect(200);
      await fx.app.get(AgentHeartbeatService).processHeartbeat(c.deviceId, fx.shop.id, {
        printers: [{ name: "C5", status: "ERROR" }],
      });
      expect((await liveJobs(fx, q3!.itemId))[0]?.id).toBe(q3!.jobId);
      for (const q of [q1!, q2!]) {
        const live = await liveJobs(fx, q.itemId);
        expect(live).toHaveLength(1);
        expect(live[0]?.id).toBe(q.jobId);
        expect(live[0]?.printerId).toBe(a.printer.id);
        expect(live[0]?.status).toBe("QUEUED");
      }
    });
  });
});
