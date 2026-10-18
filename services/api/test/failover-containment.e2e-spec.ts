import { OrderStatus } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import { AgentHeartbeatService } from "../src/agents/agent-heartbeat.service.js";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

async function seedJob(
  fx: Fx,
  printerId: string,
  status: "QUEUED" | "PRINTING",
): Promise<{ jobId: string; itemId: string; orderId: string }> {
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
  return { jobId: job.id, itemId: itemIds[0]!, orderId };
}

describe("Failover containment and visibility (19.9, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("fo-contain", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await fx?.cleanup();
  });

  it("(a) a DB error in the post-accrual lookup cannot fail the agent's PRINTED report; job and usage stay committed", async () => {
    const a = await fx.makePrinter("C-A", { pageLimit: 50, pageLimitEnabled: true });
    const { jobId } = await seedJob(fx, a.printer.id, "PRINTING");
    const prisma = fx.app.get(PrismaService);
    const spy = jest
      .spyOn(prisma.printer, "findUnique")
      .mockImplementation((() => Promise.reject(new Error("simulated db failure"))) as never);
    try {
      // CONTROL: the spy really intercepts the delegate production uses; if
      // Prisma handed out a fresh proxy per access this would resolve and the
      // whole test would be vacuous.
      await expect(prisma.printer.findUnique({ where: { id: a.printer.id } })).rejects.toThrow(
        "simulated db failure",
      );
      spy.mockClear();

      await expect(
        fx.app.get(AgentJobsService).reportStatus(jobId, a.deviceId, { status: "PRINTED" }),
      ).resolves.toBeUndefined();
      // The failure injection actually fired inside production code.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    const job = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("PRINTED");
    const usage = await fx.prisma.printerPageUsage.findFirstOrThrow({
      where: { printerId: a.printer.id },
    });
    expect(usage.pagesUsed).toBe(5);
  });

  it("(b) a failover-parked WAITING job is visible to staff with its blockedReason, the order derives PREPARING, and staff can reassign it manually", async () => {
    const a = await fx.makePrinter("V-A");
    const seeded = await seedJob(fx, a.printer.id, "QUEUED");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { not: a.printer.id } },
      data: { status: "DISABLED" },
    });
    await request(fx.app.getHttpServer())
      .patch(`/v1/shop/printers/${a.printer.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ enabled: false })
      .expect(200);

    const detail = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${seeded.orderId}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    expect(detail.body.orderStatus).toBe("PREPARING");
    expect(detail.body.printJobs).toHaveLength(1);
    expect(detail.body.printJobs[0]).toMatchObject({
      id: seeded.jobId,
      status: "WAITING",
      blockedReason: "PRINTER_DISABLED",
      printerName: null,
    });

    const list = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders?shopId=${fx.shop.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    const all = Object.values(list.body as Record<string, Array<{ id: string }>>).flat();
    expect(all.map((o) => o.id)).toContain(seeded.orderId);

    // Staff manually reassign the parked job to a working printer.
    const target = await fx.makePrinter("V-B");
    const res = await request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${seeded.jobId}/reassign`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ printerId: target.printer.id, reason: "staff picked a printer" })
      .expect(200);
    expect(res.body.printerId).toBe(target.printer.id);
    const live = await fx.prisma.printJob.findMany({
      where: { orderItemId: seeded.itemId, supersededAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.status).toBe("QUEUED");
  });

  it("(c) a failing or slow re-evaluation cannot fail the heartbeat, and its effect on jobs/orders is what we expect", async () => {
    const a = await fx.makePrinter("H-A");
    const b = await fx.makePrinter("H-B");
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { notIn: [a.printer.id, b.printer.id] } },
      data: { status: "DISABLED" },
    });
    const failingJob = await seedJob(fx, a.printer.id, "QUEUED");
    const prisma = fx.app.get(PrismaService);
    const heartbeat = fx.app.get(AgentHeartbeatService);
    const beat = () =>
      heartbeat.processHeartbeat(a.deviceId, fx.shop.id, {
        printers: [{ name: "H-A", status: "ERROR" }],
      });

    // ---- failing re-evaluation
    const failing = jest
      .spyOn(prisma.shop, "findUnique")
      .mockImplementation((() => Promise.reject(new Error("simulated db failure"))) as never);
    try {
      // CONTROL: the spy intercepts the delegate.
      await expect(prisma.shop.findUnique({ where: { id: fx.shop.id } })).rejects.toThrow(
        "simulated db failure",
      );
      failing.mockClear();
      await expect(beat()).resolves.toBeUndefined();
      expect(failing).toHaveBeenCalled();
    } finally {
      failing.mockRestore();
    }
    // The heartbeat's own effect stands...
    expect(
      (await fx.prisma.printer.findUniqueOrThrow({ where: { id: a.printer.id } })).status,
    ).toBe("ERROR");
    // ...and the failed failover left the job exactly where it was (nothing
    // half-moved), still one live job.
    const stayed = await fx.prisma.printJob.findMany({
      where: { orderItemId: failingJob.itemId, supersededAt: null },
    });
    expect(stayed.map((j) => [j.id, j.status, j.printerId])).toEqual([
      [failingJob.jobId, "QUEUED", a.printer.id],
    ]);

    // ---- slow re-evaluation: the beat waits, still succeeds, and the move happens.
    await fx.prisma.printer.update({ where: { id: a.printer.id }, data: { status: "ONLINE" } });
    const original = prisma.shop.findUnique.bind(prisma.shop);
    const slow = jest
      .spyOn(prisma.shop, "findUnique")
      .mockImplementation(((args: never) =>
        new Promise((resolve) => setTimeout(resolve, 300)).then(() => original(args))) as never);
    const started = Date.now();
    try {
      await expect(beat()).resolves.toBeUndefined();
      expect(slow).toHaveBeenCalled();
    } finally {
      slow.mockRestore();
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    const moved = await fx.prisma.printJob.findMany({
      where: { orderItemId: failingJob.itemId, supersededAt: null },
    });
    expect(moved).toHaveLength(1);
    expect(moved[0]?.printerId).toBe(b.printer.id);
    expect(moved[0]?.status).toBe("QUEUED");
  });
});
