import { OrderStatus, PrinterStatus } from "@prisma/client";
import {
  PrintJobStateMachine,
  PrismaService,
  periodStart,
  reallocateWaitingJobs,
} from "@print-automated/backend-shared";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";

type Toggles = Partial<{
  autoPrinterAssignmentEnabled: boolean;
  autoQueueManagementEnabled: boolean;
  automaticNotificationsEnabled: boolean;
  pageLimitEnforcementEnabled: boolean;
  notificationSettings: { emailEnabled: boolean; appEnabled: boolean };
  autoFailoverEnabled: boolean;
}>;

/** Writes straight to the tables (the settings API itself is covered by
 * shop-settings.e2e-spec.ts); the point here is what the AUTOMATIC paths do. */
async function setAuto(fx: Fx, patch: Toggles): Promise<void> {
  const { autoFailoverEnabled, ...settings } = patch;
  if (autoFailoverEnabled !== undefined) {
    await fx.prisma.shop.update({ where: { id: fx.shop.id }, data: { autoFailoverEnabled } });
  }
  if (Object.keys(settings).length > 0) {
    await fx.prisma.shopSettings.update({ where: { shopId: fx.shop.id }, data: settings });
  }
}
const DEFAULTS: Required<Toggles> = {
  autoPrinterAssignmentEnabled: true,
  autoQueueManagementEnabled: true,
  automaticNotificationsEnabled: true,
  pageLimitEnforcementEnabled: true,
  notificationSettings: { emailEnabled: true, appEnabled: true },
  autoFailoverEnabled: true,
};

function http(fx: Fx) {
  return request(fx.app.getHttpServer());
}
function accept(fx: Fx, orderId: string) {
  return http(fx)
    .post(`/v1/shop/orders/${orderId}/accept`)
    .set("Authorization", `Bearer ${fx.token}`);
}
function post(fx: Fx, path: string, body: Record<string, unknown> = {}) {
  return http(fx).post(path).set("Authorization", `Bearer ${fx.token}`).send(body);
}
async function seedWaiting(fx: Fx, blockedReason: string) {
  const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
  const job = await fx.prisma.printJob.create({
    data: {
      orderId,
      shopId: fx.shop.id,
      orderItemId: itemIds[0]!,
      printerId: null,
      status: "WAITING",
      blockedReason,
      idempotencyToken: `${itemIds[0]}:1`,
    },
  });
  return job.id;
}
const reload = (fx: Fx, id: string) => fx.prisma.printJob.findUniqueOrThrow({ where: { id } });

/** 22.2 (PRD 76/122): every AUTOMATIC path reads its toggle; manual paths never do. */
describe("Automation toggles (22.2, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    await clearOfUtcMidnight();
    // multi-item OFF on purpose: the strictest legacy mode, where a blocked allocation used to be a 409.
    fx = await createPhase19Fixture("auto-toggles", {
      multiItemEnabled: false,
      autoFailoverEnabled: true,
      documentPages: 5,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });
  beforeEach(async () => {
    await setAuto(fx, DEFAULTS);
    await fx.prisma.printJob.deleteMany({ where: { shopId: fx.shop.id } });
    // earlier tests' printers must not compete: only the printer a test creates is eligible
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id },
      data: { status: PrinterStatus.DISABLED },
    });
  });

  describe("automatic printer assignment (dispatch)", () => {
    it("ON (default): accept allocates a QUEUED job exactly as before", async () => {
      const { printer } = await fx.makePrinter("D-on");
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
      expect(job).toMatchObject({ status: "QUEUED", printerId: printer.id, blockedReason: null });
    });

    it("OFF: accept still succeeds, the job WAITS visibly as AUTOMATION_DISABLED, and staff assign it by hand", async () => {
      await setAuto(fx, { autoPrinterAssignmentEnabled: false });
      const { printer } = await fx.makePrinter("D-off");
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
      expect(job).toMatchObject({
        status: "WAITING",
        printerId: null,
        blockedReason: "AUTOMATION_DISABLED",
      });
      expect(
        (await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus,
      ).toBe(OrderStatus.QUEUED_FOR_PRINT);

      // manual intervention stays available (PRD 122): reassign works with automation off
      const res = await post(fx, `/v1/print-jobs/${job.id}/reassign`, {
        printerId: printer.id,
        reason: "manual while automation is off",
      }).expect(200);
      expect(res.body).toMatchObject({ status: "QUEUED", printerId: printer.id });
    });

    it("OFF: exactly one WAITING job is created per item (no duplicates, no allocation)", async () => {
      await setAuto(fx, { autoPrinterAssignmentEnabled: false });
      await fx.makePrinter("D-off-2");
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const jobs = await fx.prisma.printJob.findMany({ where: { orderId } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.blockedReason).toBe("AUTOMATION_DISABLED");
    });
  });

  describe("resume (automatic allocation when no printer is named)", () => {
    it("OFF: resume with no printer parks the job as AUTOMATION_DISABLED; resume naming a printer queues it", async () => {
      const { printer } = await fx.makePrinter("R-1");
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
      await post(fx, `/v1/print-jobs/${job.id}/pause`, { reason: "hold" }).expect(200);

      await setAuto(fx, { autoPrinterAssignmentEnabled: false });
      await post(fx, `/v1/print-jobs/${job.id}/resume`, {}).expect(200);
      expect(await reload(fx, job.id)).toMatchObject({
        status: "WAITING",
        printerId: null,
        blockedReason: "AUTOMATION_DISABLED",
      });

      // a second job: pause, then resume with an explicit printer while automation is off
      const second = await fx.makeOrder(1);
      await setAuto(fx, { autoPrinterAssignmentEnabled: true });
      await accept(fx, second.orderId).expect(200);
      const j2 = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId: second.orderId } });
      await post(fx, `/v1/print-jobs/${j2.id}/pause`, { reason: "hold" }).expect(200);
      await setAuto(fx, { autoPrinterAssignmentEnabled: false });
      await post(fx, `/v1/print-jobs/${j2.id}/resume`, { printerId: printer.id }).expect(200);
      expect(await reload(fx, j2.id)).toMatchObject({ status: "QUEUED", printerId: printer.id });
    });
  });

  describe("automatic failover", () => {
    it("failover ON but automatic assignment OFF: the queued job is unallocated (visible), not moved to another printer", async () => {
      const a = await fx.makePrinter("F-A");
      await fx.makePrinter("F-B");
      const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
      const job = await fx.prisma.printJob.create({
        data: {
          orderId,
          shopId: fx.shop.id,
          orderItemId: itemIds[0]!,
          printerId: a.printer.id,
          status: "QUEUED",
          idempotencyToken: `${itemIds[0]}:1`,
        },
      });
      await setAuto(fx, { autoPrinterAssignmentEnabled: false });
      await http(fx)
        .patch(`/v1/shop/printers/${a.printer.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ enabled: false })
        .expect(200);
      const live = await fx.prisma.printJob.findMany({
        where: { orderItemId: itemIds[0]!, supersededAt: null },
      });
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({
        id: job.id,
        status: "WAITING",
        printerId: null,
        blockedReason: "AUTOMATION_DISABLED",
      });
    });
  });

  describe("queue recovery (reallocateWaitingJobs)", () => {
    const run = (extra: Parameters<typeof reallocateWaitingJobs>[1] = {}) =>
      reallocateWaitingJobs(
        { prisma: fx.app.get(PrismaService), jobMachine: fx.app.get(PrintJobStateMachine) },
        { shopId: fx.shop.id, ...extra },
      );

    it("automatic queue management OFF: nothing is recovered, the job stays WAITING and untouched", async () => {
      await fx.makePrinter("Q-1");
      const jobId = await seedWaiting(fx, "PRINTER_OFFLINE");
      await setAuto(fx, { autoQueueManagementEnabled: false });
      const result = await run();
      expect(result.outcomes).toEqual([]);
      expect(await reload(fx, jobId)).toMatchObject({ status: "WAITING", printerId: null });
    });

    it("automatic printer assignment OFF: recovery does not allocate either", async () => {
      await fx.makePrinter("Q-2");
      const jobId = await seedWaiting(fx, "PRINTER_OFFLINE");
      await setAuto(fx, { autoPrinterAssignmentEnabled: false });
      expect((await run()).outcomes).toEqual([]);
      expect((await reload(fx, jobId)).status).toBe("WAITING");
    });

    it("defaults (all ON): recovery allocates as before, and also picks up AUTOMATION_DISABLED jobs once assignment is back on", async () => {
      const { printer } = await fx.makePrinter("Q-3");
      const offline = await seedWaiting(fx, "PRINTER_OFFLINE");
      const disabled = await seedWaiting(fx, "AUTOMATION_DISABLED");
      const result = await run();
      expect(result.outcomes.map((o) => o.action).sort()).toEqual(["ALLOCATED", "ALLOCATED"]);
      expect(await reload(fx, offline)).toMatchObject({ status: "QUEUED", printerId: printer.id });
      expect(await reload(fx, disabled)).toMatchObject({ status: "QUEUED", printerId: printer.id });
    });

    it("a shop that never opted in to failover still recovers AUTOMATION_DISABLED jobs, but not availability ones", async () => {
      await setAuto(fx, { autoFailoverEnabled: false });
      const { printer } = await fx.makePrinter("Q-3b");
      const offline = await seedWaiting(fx, "PRINTER_OFFLINE");
      const disabled = await seedWaiting(fx, "AUTOMATION_DISABLED");
      const result = await run();
      expect(result.outcomes).toEqual([
        expect.objectContaining({ jobId: disabled, action: "ALLOCATED" }),
      ]);
      expect(await reload(fx, disabled)).toMatchObject({ status: "QUEUED", printerId: printer.id });
      expect((await reload(fx, offline)).status).toBe("WAITING");
    });

    it("restock recovery (NO_PAPER) sits behind automatic queue management too", async () => {
      await fx.makePrinter("Q-4");
      const jobId = await seedWaiting(fx, "NO_PAPER");
      await setAuto(fx, { autoQueueManagementEnabled: false });
      await fx.app.get(AgentJobsService).recoverPaperBlockedJobs(fx.shop.id);
      expect((await reload(fx, jobId)).status).toBe("WAITING");
      await setAuto(fx, { autoQueueManagementEnabled: true });
      await fx.app.get(AgentJobsService).recoverPaperBlockedJobs(fx.shop.id);
      expect((await reload(fx, jobId)).status).toBe("QUEUED");
    });

    it("a toggle switched off after the candidate read is honoured under the locks (no allocation, no audit)", async () => {
      await fx.makePrinter("Q-5");
      const jobId = await seedWaiting(fx, "PRINTER_OFFLINE");
      const prisma = fx.app.get(PrismaService);
      const result = await reallocateWaitingJobs(
        {
          prisma,
          jobMachine: fx.app.get(PrintJobStateMachine),
          afterCandidatesRead: async () => {
            await prisma.shopSettings.update({
              where: { shopId: fx.shop.id },
              data: { autoQueueManagementEnabled: false },
            });
          },
        },
        { shopId: fx.shop.id },
      );
      expect(result.outcomes).toEqual([{ jobId, action: "SKIPPED" }]);
      expect(await reload(fx, jobId)).toMatchObject({ status: "WAITING", printerId: null });
      expect(
        await fx.prisma.auditLog.count({
          where: { resourceId: jobId, action: "PRINT_JOB_ALLOCATE" },
        }),
      ).toBe(0);
    });

    it("same for automatic printer assignment switched off mid-tick", async () => {
      await fx.makePrinter("Q-6");
      const jobId = await seedWaiting(fx, "PRINTER_OFFLINE");
      const prisma = fx.app.get(PrismaService);
      const result = await reallocateWaitingJobs(
        {
          prisma,
          jobMachine: fx.app.get(PrintJobStateMachine),
          afterCandidatesRead: async () => {
            await prisma.shopSettings.update({
              where: { shopId: fx.shop.id },
              data: { autoPrinterAssignmentEnabled: false },
            });
          },
        },
        { shopId: fx.shop.id },
      );
      expect(result.outcomes).toEqual([{ jobId, action: "SKIPPED" }]);
      expect((await reload(fx, jobId)).status).toBe("WAITING");
    });

    it("a toggle write racing recovery (Promise.all): never allocated after the write, never a deadlock", async () => {
      await fx.makePrinter("Q-7");
      const jobId = await seedWaiting(fx, "PRINTER_OFFLINE");
      const prisma = fx.app.get(PrismaService);
      const put = http(fx)
        .put("/v1/shop/settings")
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ shopId: fx.shop.id, autoQueueManagementEnabled: false })
        .then((r) => r.status);
      const [recovery, status] = await Promise.all([run(), put]);
      expect(status).toBe(200);
      expect(recovery.errors).toEqual([]);
      const after = await reload(fx, jobId);
      // either serialisation is legal; what is not legal is a later tick moving it
      await run();
      expect((await reload(fx, jobId)).status).toBe(after.status);
      void prisma;
    });
  });

  describe("automatic page-limit enforcement (allocatePrinter candidates)", () => {
    async function limitedPrinter() {
      const { printer } = await fx.makePrinter("PL", { pageLimit: 5, pageLimitEnabled: true });
      await fx.prisma.printerPageUsage.create({
        data: {
          printerId: printer.id,
          periodStart: periodStart("DAILY", new Date()),
          pagesUsed: 5,
        },
      });
      return printer;
    }
    afterEach(async () => {
      await fx.prisma.printerPageUsage.deleteMany({
        where: { printer: { shopId: fx.shop.id } },
      });
    });

    it("ON (default): a printer at its limit is not eligible (409 in legacy mode), as before", async () => {
      await limitedPrinter();
      const { orderId } = await fx.makeOrder(1);
      const res = await accept(fx, orderId).expect(409);
      expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");
    });

    it("OFF: the limit is not enforced and the printer takes the job", async () => {
      const printer = await limitedPrinter();
      await setAuto(fx, { pageLimitEnforcementEnabled: false });
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
      expect(job).toMatchObject({ status: "QUEUED", printerId: printer.id });
    });
  });

  describe("automatic notifications", () => {
    const notificationsFor = (orderId: string) =>
      fx.prisma.notification.findMany({
        where: { orderId },
        select: { channel: true, type: true },
      });

    it("ON (default): an accepted order notifies the customer on APP and EMAIL", async () => {
      await fx.makePrinter("N-1");
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const rows = await notificationsFor(orderId);
      expect(rows.map((r) => r.channel).sort()).toEqual(["APP", "EMAIL"]);
    });

    it("OFF: no customer notification rows are created at all; the order flow itself is unchanged", async () => {
      await setAuto(fx, { automaticNotificationsEnabled: false });
      await fx.makePrinter("N-2");
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      expect(await notificationsFor(orderId)).toEqual([]);
      expect((await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } })).status).toBe(
        "QUEUED",
      );
    });

    it("channel settings: email off leaves APP only; app off leaves EMAIL only", async () => {
      await fx.makePrinter("N-3");
      await setAuto(fx, { notificationSettings: { emailEnabled: false, appEnabled: true } });
      const a = await fx.makeOrder(1);
      await accept(fx, a.orderId).expect(200);
      expect((await notificationsFor(a.orderId)).map((r) => r.channel)).toEqual(["APP"]);

      await setAuto(fx, { notificationSettings: { emailEnabled: true, appEnabled: false } });
      const b = await fx.makeOrder(1);
      await accept(fx, b.orderId).expect(200);
      expect((await notificationsFor(b.orderId)).map((r) => r.channel)).toEqual(["EMAIL"]);
    });
  });
});
