import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 19.8/19.10: what a customer actually experiences when failover's
 * UNALLOCATE lowers an order from QUEUED_FOR_PRINT to PREPARING, WITH a
 * positive control in the same fixture proving the notification path is live
 * (otherwise "no notification" would also pass if notifications were broken). */
describe("UNALLOCATE and the customer (19.8/19.10, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("fo-notify", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  async function seedOne(printerId: string): Promise<{ orderId: string; jobId: string }> {
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
    return { orderId, jobId: job.id };
  }

  it("POSITIVE CONTROL: a comparable real transition (QUEUED -> PRINTING via the agent path) DOES create a notification and is audited", async () => {
    const p = await fx.makePrinter("N-CTRL");
    const { orderId, jobId } = await seedOne(p.printer.id);
    const before = await fx.prisma.notification.count({ where: { orderId } });

    await fx.app.get(AgentJobsService).reportStatus(jobId, p.deviceId, { status: "PRINTING" });

    const order = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINTING);
    const after = await fx.prisma.notification.findMany({ where: { orderId } });
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((n) => n.type === "PRINT_STARTED")).toBe(true);
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_SYNC_JOBS" },
    });
    expect(audit?.metadata).toMatchObject({ from: "QUEUED_FOR_PRINT", to: "PRINTING" });
  });

  it("the order drops to PREPARING, the change is audited, and NO customer notification is created (not a misleading print started/failed)", async () => {
    const a = await fx.makePrinter("N-A");
    // Take the control's printer out of contention: nothing else may qualify.
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id, id: { not: a.printer.id } },
      data: { status: "DISABLED" },
    });
    const { orderId, jobId } = await seedOne(a.printer.id);
    const before = await fx.prisma.notification.count({ where: { orderId } });

    await request(fx.app.getHttpServer())
      .patch(`/v1/shop/printers/${a.printer.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ enabled: false })
      .expect(200);

    const moved = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(moved.status).toBe("WAITING");
    const order = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PREPARING);
    expect(await fx.prisma.notification.count({ where: { orderId } })).toBe(before);
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_SYNC_JOBS" },
    });
    expect(audit?.actorId).toBeNull();
    expect(audit?.metadata).toMatchObject({ from: "QUEUED_FOR_PRINT", to: "PREPARING" });
  });
});
