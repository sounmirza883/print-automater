import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 21.7: a reprint on an order that is already READY_FOR_COLLECTION (where the
 * order machine no longer re-derives from jobs) must not let the order be
 * COMPLETEd under a live reprint, must not disturb the quality-check status, and
 * turning QC off must unblock a stale PENDING. */
describe("Reprint / quality-check / completion consistency (21.7, e2e)", () => {
  let fx: Fx;
  let deviceId: string;
  let printerId: string;

  beforeAll(async () => {
    fx = await createPhase19Fixture("reprint-consistency", { multiItemEnabled: true });
    const p = await fx.makePrinter("RC-A");
    deviceId = p.deviceId;
    printerId = p.printer.id;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const order = (id: string) => fx.prisma.order.findUniqueOrThrow({ where: { id } });
  const call = (orderId: string, path: string, body: object = {}) =>
    request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/${path}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send(body);
  const reprint = (jobId: string) =>
    request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reprint`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "POOR_QUALITY" });

  async function readyOrder(qc?: string) {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.READY_FOR_COLLECTION);
    if (qc) {
      await fx.prisma.order.update({ where: { id: orderId }, data: { qualityCheckStatus: qc } });
    }
    const j = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId,
        status: "PRINTED",
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return { orderId, jobId: j.id };
  }

  it("COMPLETE is refused (409 REPRINT_IN_PROGRESS) while a reprint of a READY order is live, and allowed once it has printed", async () => {
    const s = await readyOrder();
    const rp = await reprint(s.jobId).expect(200);
    const newJobId = rp.body.job.id as string;
    // the order machine does not re-derive from READY_FOR_COLLECTION
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);

    const denied = await call(s.orderId, "complete").expect(409);
    expect(denied.body.error_code).toBe("REPRINT_IN_PROGRESS");
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);

    const agent = fx.app.get(AgentJobsService);
    await agent.claim(newJobId, deviceId);
    await agent.reportStatus(newJobId, deviceId, { status: "PRINTING" });
    await agent.reportStatus(newJobId, deviceId, { status: "PRINTED" });
    await call(s.orderId, "complete").expect(200);
  });

  it("race: COMPLETE versus reprint (Promise.all): never COMPLETED with a live reprint job", async () => {
    for (let i = 0; i < 4; i += 1) {
      const s = await readyOrder();
      const [c, r] = await Promise.all([call(s.orderId, "complete"), reprint(s.jobId)]);
      const final = await order(s.orderId);
      const live = await fx.prisma.printJob.count({
        where: { orderId: s.orderId, status: { in: ["QUEUED", "WAITING", "CLAIMED", "PRINTING"] } },
      });
      if (final.orderStatus === OrderStatus.COMPLETED) {
        expect(live).toBe(0);
        expect(r.status).toBe(409);
      } else {
        expect(c.status).toBe(409);
        expect(r.status).toBe(200);
      }
    }
  });

  it("a reprint on a READY order leaves quality_check_status alone (QC ON shop, PASSED stays PASSED)", async () => {
    await fx.prisma.shop.update({ where: { id: fx.shop.id }, data: { qualityCheckEnabled: true } });
    try {
      const s = await readyOrder("PASSED");
      await reprint(s.jobId).expect(200);
      expect((await order(s.orderId)).qualityCheckStatus).toBe("PASSED");
    } finally {
      await fx.prisma.shop.update({
        where: { id: fx.shop.id },
        data: { qualityCheckEnabled: false },
      });
    }
  });

  it("markReady consults the shop toggle: a stale PENDING on a PRINTED order is blocked while QC is on, unblocked once QC is turned off", async () => {
    const { orderId } = await fx.makeOrder(1, 1, OrderStatus.PRINTED);
    await fx.prisma.order.update({
      where: { id: orderId },
      data: { qualityCheckStatus: "PENDING" },
    });

    await fx.prisma.shop.update({ where: { id: fx.shop.id }, data: { qualityCheckEnabled: true } });
    const blocked = await call(orderId, "ready").expect(409);
    expect(blocked.body.error_code).toBe("QUALITY_CHECK_REQUIRED");

    await fx.prisma.shop.update({
      where: { id: fx.shop.id },
      data: { qualityCheckEnabled: false },
    });
    await call(orderId, "ready").expect(200);
    expect((await order(orderId)).orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);
  });
});
