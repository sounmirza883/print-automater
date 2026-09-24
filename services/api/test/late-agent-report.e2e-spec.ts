import { PrintJobEvent, PrintJobStateMachine } from "@print-automated/backend-shared";
import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

type JobStatus = "TIMEOUT" | "FAILED" | "PRINTED" | "QUEUED" | "REASSIGNED";

async function seed(
  fx: Fx,
  printerId: string,
  status: JobStatus,
  orderStatus: OrderStatus,
  superseded = false,
): Promise<{ jobId: string; itemId: string; orderId: string }> {
  const { orderId, itemIds } = await fx.makeOrder(1, 1, orderStatus);
  const job = await fx.prisma.printJob.create({
    data: {
      orderId,
      shopId: fx.shop.id,
      orderItemId: itemIds[0]!,
      printerId,
      status,
      idempotencyToken: `${itemIds[0]}:1`,
      ...(superseded ? { supersededAt: new Date() } : {}),
    },
  });
  return { jobId: job.id, itemId: itemIds[0]!, orderId };
}

describe("Late agent reports are never dropped (19.13, e2e)", () => {
  let fx: Fx;
  let printerId: string;
  let deviceId: string;
  beforeAll(async () => {
    fx = await createPhase19Fixture("late-report", { multiItemEnabled: true });
    const p = await fx.makePrinter("L-A");
    printerId = p.printer.id;
    deviceId = p.deviceId;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });
  const agent = () => fx.app.get(AgentJobsService);
  const job = (id: string) => fx.prisma.printJob.findUniqueOrThrow({ where: { id } });
  const order = (id: string) => fx.prisma.order.findUniqueOrThrow({ where: { id } });
  const audits = (jobId: string) =>
    fx.prisma.auditLog.findMany({ where: { resourceId: jobId, action: "PRINT_JOB_LATE_REPORT" } });

  it("a late PRINTED on a timed-out live job lands as UNKNOWN, the order asks staff to resolve, and a blind retry cannot reprint", async () => {
    const s = await seed(fx, printerId, "TIMEOUT", OrderStatus.PRINT_FAILED);
    await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });

    expect((await job(s.jobId)).status).toBe("UNKNOWN");
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);
    expect(await audits(s.jobId)).toHaveLength(1);
    // The page counter must not treat unconfirmed paper as completed usage.
    expect(await fx.prisma.printerPageUsage.findFirst({ where: { printerId } })).toBeNull();

    await request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${s.orderId}/retry-print`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({});
    const jobs = await fx.prisma.printJob.findMany({ where: { orderId: s.orderId } });
    expect(jobs).toHaveLength(1);
  });

  it("a late PRINTED on an agent-FAILED job lands as UNKNOWN as well", async () => {
    const s = await seed(fx, printerId, "FAILED", OrderStatus.PRINT_FAILED);
    await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });
    expect((await job(s.jobId)).status).toBe("UNKNOWN");
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);
  });

  it("a late UNKNOWN report on a timed-out job lands as UNKNOWN", async () => {
    const s = await seed(fx, printerId, "TIMEOUT", OrderStatus.PRINT_FAILED);
    await agent().reportStatus(s.jobId, deviceId, { status: "UNKNOWN" });
    expect((await job(s.jobId)).status).toBe("UNKNOWN");
  });

  it("a late FAILED or PRINTING report changes nothing (no paper implied)", async () => {
    const s = await seed(fx, printerId, "TIMEOUT", OrderStatus.PRINT_FAILED);
    await agent().reportStatus(s.jobId, deviceId, { status: "FAILED" });
    await agent().reportStatus(s.jobId, deviceId, { status: "PRINTING" });
    expect((await job(s.jobId)).status).toBe("TIMEOUT");
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);
  });

  it("a late PRINTED on a job already failed over (REASSIGNED, superseded) is recorded as UNKNOWN evidence and its live successor is held (order shows PAUSED)", async () => {
    const s = await seed(fx, printerId, "REASSIGNED", OrderStatus.QUEUED_FOR_PRINT, true);
    const successor = await fx.prisma.printJob.create({
      data: {
        orderId: s.orderId,
        shopId: fx.shop.id,
        orderItemId: s.itemId,
        printerId,
        status: "QUEUED",
        attempt: 2,
        idempotencyToken: `${s.itemId}:2`,
      },
    });
    await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });

    const old = await job(s.jobId);
    expect(old.status).toBe("UNKNOWN");
    expect(old.supersededAt).not.toBeNull();
    // 19.18: the live successor is held for a human, not left dispatchable.
    expect((await job(successor.id)).status).toBe("PAUSED");
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.PAUSED);
    expect(await audits(s.jobId)).toHaveLength(1);
  });

  describe("19.18: a late PRINTED never leaves a live successor free to print a second copy", () => {
    async function supersededWithSuccessor(
      successorStatus: "QUEUED" | "WAITING" | "CLAIMED" | "PRINTING",
    ) {
      const s = await seed(fx, printerId, "REASSIGNED", OrderStatus.QUEUED_FOR_PRINT, true);
      const successor = await fx.prisma.printJob.create({
        data: {
          orderId: s.orderId,
          shopId: fx.shop.id,
          orderItemId: s.itemId,
          printerId: successorStatus === "WAITING" ? null : printerId,
          status: successorStatus,
          ...(successorStatus === "WAITING" ? { blockedReason: "PRINTER_OFFLINE" } : {}),
          attempt: 2,
          idempotencyToken: `${s.itemId}:2`,
        },
      });
      return { ...s, successorId: successor.id };
    }
    const holdAudits = (oldJobId: string) =>
      fx.prisma.auditLog.findMany({
        where: { resourceId: oldJobId, action: "PRINT_JOB_LATE_PRINT_SUCCESSOR" },
      });

    it("holds a QUEUED successor (PAUSED, audited, no longer dispatchable) and staff can resume it", async () => {
      const s = await supersededWithSuccessor("QUEUED");
      await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });

      const held = await job(s.successorId);
      expect(held.status).toBe("PAUSED");
      expect(held.blockedReason).toBe("MANUAL_APPROVAL_REQUIRED");
      expect(
        await fx.prisma.printJob.count({ where: { orderId: s.orderId, status: "QUEUED" } }),
      ).toBe(0);
      await expect(agent().claim(s.successorId, deviceId)).rejects.toMatchObject({
        errorCode: "JOB_NOT_FOUND",
      });
      const rows = await holdAudits(s.jobId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({ successorJobId: s.successorId, held: true });

      const machine = fx.app.get(PrintJobStateMachine);
      await machine.transition(s.successorId, PrintJobEvent.RESUME, { id: fx.owner.id });
      expect((await job(s.successorId)).status).toBe("WAITING");
    });

    it("holds a WAITING successor too", async () => {
      const s = await supersededWithSuccessor("WAITING");
      await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });
      expect((await job(s.successorId)).status).toBe("PAUSED");
      expect(await holdAudits(s.jobId)).toHaveLength(1);
    });

    it.each(["CLAIMED", "PRINTING"] as const)(
      "leaves a %s successor alone but audits the duplicate risk",
      async (status) => {
        const s = await supersededWithSuccessor(status);
        await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });
        expect((await job(s.successorId)).status).toBe(status);
        const rows = await holdAudits(s.jobId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.metadata).toMatchObject({ successorJobId: s.successorId, held: false });
      },
    );

    it("a late PRINTED racing the successor's claim (Promise.all) never leaves it QUEUED", async () => {
      const s = await supersededWithSuccessor("QUEUED");
      await Promise.all([
        agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" }),
        agent()
          .claim(s.successorId, deviceId)
          .catch(() => undefined),
      ]);
      const after = await job(s.successorId);
      expect(["PAUSED", "CLAIMED"]).toContain(after.status);
      const rows = await holdAudits(s.jobId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({ held: after.status === "PAUSED" });
    });
  });

  it("a replayed PRINTED on a job that really printed stays PRINTED and is not audited as late", async () => {
    const s = await seed(fx, printerId, "PRINTED", OrderStatus.PRINTING);
    await agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" });
    expect((await job(s.jobId)).status).toBe("PRINTED");
    expect(await audits(s.jobId)).toHaveLength(0);
  });

  it("a late PRINTED racing a staff retry (Promise.all) is never lost: the old job ends UNKNOWN whichever wins", async () => {
    const s = await seed(fx, printerId, "TIMEOUT", OrderStatus.PRINT_FAILED);
    await Promise.all([
      agent().reportStatus(s.jobId, deviceId, { status: "PRINTED" }),
      request(fx.app.getHttpServer())
        .post(`/v1/shop/orders/${s.orderId}/retry-print`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({}),
    ]);
    expect((await job(s.jobId)).status).toBe("UNKNOWN");
    const live = await fx.prisma.printJob.findMany({
      where: { orderId: s.orderId, supersededAt: null },
    });
    expect(live.length).toBeLessThanOrEqual(1);
  });
});
