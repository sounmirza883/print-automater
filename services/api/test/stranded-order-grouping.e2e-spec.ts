import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

type Grouped = Record<string, Array<{ id: string; printJobs: Array<Record<string, unknown>> }>>;

describe("A stranded order stands out to staff (19.12, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("stranded", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  function list() {
    return request(fx.app.getHttpServer())
      .get(`/v1/shop/orders?shopId=${fx.shop.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200)
      .then((res) => res.body as Grouped);
  }
  const groupOf = (grouped: Grouped, orderId: string): string | undefined =>
    Object.entries(grouped).find(([, orders]) => orders.some((o) => o.id === orderId))?.[0];

  it("a failover-parked order is in needsAttention with the blocked reason, and returns to printing once staff reassign it", async () => {
    const a = await fx.makePrinter("G-A");
    // A healthy order on A for contrast: it must stay in `printing`.
    const healthy = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
    const healthyJob = await fx.prisma.printJob.create({
      data: {
        orderId: healthy.orderId,
        shopId: fx.shop.id,
        orderItemId: healthy.itemIds[0]!,
        printerId: a.printer.id,
        status: "PRINTING",
        idempotencyToken: `${healthy.itemIds[0]}:1`,
      },
    });
    void healthyJob;

    const stranded = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
    const job = await fx.prisma.printJob.create({
      data: {
        orderId: stranded.orderId,
        shopId: fx.shop.id,
        orderItemId: stranded.itemIds[0]!,
        printerId: a.printer.id,
        status: "QUEUED",
        idempotencyToken: `${stranded.itemIds[0]}:1`,
      },
    });
    await request(fx.app.getHttpServer())
      .patch(`/v1/shop/printers/${a.printer.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ enabled: false })
      .expect(200);

    const parked = await list();
    expect(groupOf(parked, stranded.orderId)).toBe("needsAttention");
    const entry = parked.needsAttention!.find((o) => o.id === stranded.orderId)!;
    expect(entry.printJobs[0]).toMatchObject({
      id: job.id,
      status: "WAITING",
      blockedReason: "PRINTER_DISABLED",
    });
    // A comparable order with no blocked job is UNCHANGED (still printing).
    expect(groupOf(parked, healthy.orderId)).toBe("printing");

    const target = await fx.makePrinter("G-B");
    await request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${job.id}/reassign`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ printerId: target.printer.id, reason: "staff picked a printer" })
      .expect(200);

    const after = await list();
    expect(groupOf(after, stranded.orderId)).toBe("printing");
  });
});
