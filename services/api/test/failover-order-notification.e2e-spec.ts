import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 19.8: what a customer actually experiences when failover's UNALLOCATE
 * lowers an order from QUEUED_FOR_PRINT to PREPARING. */
describe("UNALLOCATE and the customer (19.8, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("fo-notify", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx.cleanup();
  });

  it("the order drops to PREPARING and NO customer notification is created (not a misleading print started/failed)", async () => {
    const a = await fx.makePrinter("N-A");
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
    const before = await fx.prisma.notification.count({ where: { orderId } });

    await request(fx.app.getHttpServer())
      .patch(`/v1/shop/printers/${a.printer.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ enabled: false })
      .expect(200);

    const moved = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(moved.status).toBe("WAITING");
    const order = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PREPARING);
    expect(await fx.prisma.notification.count({ where: { orderId } })).toBe(before);
  });
});
