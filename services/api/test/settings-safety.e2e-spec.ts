import { OrderStatus, PrinterStatus } from "@prisma/client";
import {
  PrintJobStateMachine,
  PrismaService,
  reallocateWaitingJobs,
} from "@print-automated/backend-shared";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 22.4 (PRD 81/82): configuration changes must not silently affect existing work.
 * Operating hours (PRD 75) are configuration only: nothing in the PRD refuses orders
 * outside them, so they are stored and shown but NEVER enforced (asserted below). */
describe("Settings safety (22.4, e2e)", () => {
  let fx: Fx;
  const http = () => request(fx.app.getHttpServer());
  const auth = { Authorization: "" };
  const put = (body: Record<string, unknown>) =>
    http()
      .put("/v1/shop/settings")
      .set(auth)
      .send({ shopId: fx.shop.id, ...body });
  const accept = (orderId: string) => http().post(`/v1/shop/orders/${orderId}/accept`).set(auth);
  const jobsOf = (orderId: string) => fx.prisma.printJob.findMany({ where: { orderId } });
  const recover = () =>
    reallocateWaitingJobs(
      { prisma: fx.app.get(PrismaService), jobMachine: fx.app.get(PrintJobStateMachine) },
      { shopId: fx.shop.id },
    );

  beforeAll(async () => {
    fx = await createPhase19Fixture("settings-safety", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
      documentPages: 5,
    });
    auth.Authorization = `Bearer ${fx.token}`;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });
  beforeEach(async () => {
    await fx.prisma.printJob.deleteMany({ where: { shopId: fx.shop.id } });
    await fx.prisma.printerAutomationRule.deleteMany({ where: { shopId: fx.shop.id } });
    // earlier tests' printers must not compete
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id },
      data: { status: PrinterStatus.DISABLED },
    });
  });

  it("a price, currency or tax change never alters a confirmed order's snapshot (PRD 82)", async () => {
    await fx.makePrinter("P");
    const { orderId } = await fx.makeOrder(1);
    const before = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await fx.prisma.pricingRule.create({
      data: {
        shopId: fx.shop.id,
        version: 99,
        currency: "USD",
        pricePerPageMinor: 999_999,
        colorSurchargePerPageMinor: 999_999,
        otherCharges: {},
        minimumChargeMinor: 999_999,
      },
    });
    await put({ currency: "EUR", taxRateBasisPoints: 2500 }).expect(200);
    await accept(orderId).expect(200);
    const after = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.pricingSnapshot).toEqual(before.pricingSnapshot);
    expect(after.printConfiguration).toEqual(before.printConfiguration);
    const shopView = await http().get(`/v1/shop/orders/${orderId}`).set(auth).expect(200);
    expect(JSON.stringify(shopView.body)).not.toContain("999999");
    await fx.prisma.pricingRule.deleteMany({ where: { shopId: fx.shop.id, version: 99 } });
  });

  it("rule and toggle changes leave QUEUED/CLAIMED/PRINTING jobs exactly where they are, even with recovery ticks", async () => {
    const a = await fx.makePrinter("A");
    const b = await fx.makePrinter("B");
    const ids: string[] = [];
    for (const status of ["QUEUED", "CLAIMED", "PRINTING"] as const) {
      const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
      const job = await fx.prisma.printJob.create({
        data: {
          orderId,
          shopId: fx.shop.id,
          orderItemId: itemIds[0]!,
          printerId: a.printer.id,
          status,
          idempotencyToken: `${itemIds[0]}:1`,
        },
      });
      ids.push(job.id);
    }
    const snapshot = () =>
      fx.prisma.printJob.findMany({
        where: { id: { in: ids } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          status: true,
          printerId: true,
          supersededAt: true,
          blockedReason: true,
        },
      });
    const audits = () => fx.prisma.auditLog.count({ where: { resourceId: { in: ids } } });
    const before = await snapshot();
    const auditsBefore = await audits();

    await http()
      .post("/v1/shop/printer-rules")
      .set(auth)
      .send({ shopId: fx.shop.id, name: "prefer B", action: "PREFER", printerIds: [b.printer.id] })
      .expect(201);
    for (const flag of [false, true]) {
      await put({
        autoPrinterAssignmentEnabled: flag,
        autoQueueManagementEnabled: flag,
        pageLimitEnforcementEnabled: flag,
        automaticNotificationsEnabled: flag,
      }).expect(200);
      await recover();
    }
    expect(await snapshot()).toEqual(before);
    expect(await audits()).toBe(auditsBefore);
  });

  it("only a WAITING job reacts to a setting, and only through the existing recovery path (audited, automatic)", async () => {
    const a = await fx.makePrinter("A2");
    await put({ autoPrinterAssignmentEnabled: false }).expect(200);
    const { orderId } = await fx.makeOrder(1);
    await accept(orderId).expect(200);
    expect((await jobsOf(orderId))[0]).toMatchObject({
      status: "WAITING",
      blockedReason: "AUTOMATION_DISABLED",
    });
    await recover();
    expect((await jobsOf(orderId))[0]!.status).toBe("WAITING");
    await put({ autoPrinterAssignmentEnabled: true }).expect(200);
    // the settings write itself moves nothing: the job reacts only when recovery runs
    expect((await jobsOf(orderId))[0]!.status).toBe("WAITING");
    await recover();
    const moved = (await jobsOf(orderId))[0]!;
    expect(moved).toMatchObject({ status: "QUEUED", printerId: a.printer.id });
    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: { resourceId: moved.id, action: "PRINT_JOB_ALLOCATE" },
    });
    expect(audit.actorId).toBeNull();
    expect(audit.metadata).toMatchObject({ automatic: true, trigger: "PRINTER_RECOVERED" });
  });

  it("a settings change racing an accept (Promise.all): exactly one job, QUEUED or visibly AUTOMATION_DISABLED, never stalled or duplicated", async () => {
    await fx.makePrinter("Race");
    for (let i = 0; i < 10; i += 1) {
      await put({ autoPrinterAssignmentEnabled: true }).expect(200);
      const { orderId } = await fx.makeOrder(1);
      const [acc, res] = await Promise.all([
        accept(orderId),
        put({ autoPrinterAssignmentEnabled: false }),
      ]);
      expect(acc.status).toBe(200);
      expect(res.status).toBe(200);
      const jobs = await jobsOf(orderId);
      expect(jobs).toHaveLength(1);
      const job = jobs[0]!;
      if (job.status === "QUEUED") {
        expect(job.printerId).not.toBeNull();
      } else {
        expect(job).toMatchObject({
          status: "WAITING",
          printerId: null,
          blockedReason: "AUTOMATION_DISABLED",
        });
      }
    }
    await put({ autoPrinterAssignmentEnabled: true }).expect(200);
  });

  it("a rule change racing an accept (Promise.all): the job goes to an eligible printer, once", async () => {
    const a = await fx.makePrinter("RA");
    const b = await fx.makePrinter("RB");
    for (let i = 0; i < 6; i += 1) {
      const { orderId } = await fx.makeOrder(1);
      const [acc, rule] = await Promise.all([
        accept(orderId),
        http()
          .post("/v1/shop/printer-rules")
          .set(auth)
          .send({
            shopId: fx.shop.id,
            name: `r${i}`,
            action: "PREFER",
            printerIds: [b.printer.id],
          }),
      ]);
      expect(acc.status).toBe(200);
      expect(rule.status).toBe(201);
      const jobs = await jobsOf(orderId);
      expect(jobs).toHaveLength(1);
      expect([a.printer.id, b.printer.id]).toContain(jobs[0]!.printerId);
      await fx.prisma.printerAutomationRule.deleteMany({ where: { shopId: fx.shop.id } });
    }
  });

  it("operating hours are configuration only: an all-closed schedule never blocks an order", async () => {
    await fx.makePrinter("Hours");
    await put({ operatingHours: { timezone: "UTC", weekly: {} } }).expect(200);
    const { orderId } = await fx.makeOrder(1);
    await accept(orderId).expect(200);
    expect((await jobsOf(orderId))[0]!.status).toBe("QUEUED");
    await put({ operatingHours: null }).expect(200);
  });
});
