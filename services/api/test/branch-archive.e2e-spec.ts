import "reflect-metadata";
import { OrderStatus } from "@prisma/client";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture } from "./helpers/phase19-fixture.js";

/** A branch can only be archived once nothing depends on it any more: nobody works there (step 2),
 * no paired computer or printer is there, and no order there still needs the shop. */
describe("Archiving a branch with printers or orders (step 3, e2e)", () => {
  let fx: Phase19Fixture;
  const http = () => request(fx.app.getHttpServer());
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });
  const archive = (branchId: string) =>
    http().post(`/v1/shop/branches/${branchId}/archive`).set(owner());

  beforeAll(async () => {
    fx = await createPhase19Fixture("branch-archive", { multiItemEnabled: false });
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("is refused while a paired computer or printer is at the branch, and allowed once they are gone", async () => {
    const branch = await fx.addBranch("Has a PC");
    const { printer } = await fx.makePrinter("archive-pc-printer", {}, branch.id);

    const refused = await archive(branch.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error_code).toBe("BRANCH_HAS_PRINTERS");
    expect(
      (await fx.prisma.branch.findUniqueOrThrow({ where: { id: branch.id } })).archivedAt,
    ).toBeNull();

    // Move the PC away: the branch is free to archive.
    const moved = await http()
      .put(`/v1/shop/printers/${printer.id}/branch`)
      .set(owner())
      .send({ branchId: fx.branch.id });
    expect(moved.status).toBe(200);
    expect((await archive(branch.id)).status).toBe(200);
  });

  it("is refused while an order there still needs the shop, and allowed once it is finished", async () => {
    const branch = await fx.addBranch("Has an order");
    const { orderId } = await fx.makeOrder(
      1,
      1,
      OrderStatus.WAITING_FOR_SHOP,
      undefined,
      branch.id,
    );

    const refused = await archive(branch.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error_code).toBe("BRANCH_HAS_ORDERS");

    await fx.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: OrderStatus.COMPLETED },
    });
    expect((await archive(branch.id)).status).toBe(200);
  });

  it("does not count finished or never-submitted orders", async () => {
    const branch = await fx.addBranch("Only history");
    for (const status of [
      OrderStatus.COMPLETED,
      OrderStatus.CANCELLED,
      OrderStatus.EXPIRED,
      OrderStatus.SHOP_REJECTED,
      OrderStatus.PAYMENT_FAILED,
      OrderStatus.DRAFT,
      OrderStatus.UPLOADED,
      OrderStatus.PAYMENT_PENDING,
    ]) {
      await fx.makeOrder(1, 1, status, undefined, branch.id);
    }
    expect((await archive(branch.id)).status).toBe(200);
  });

  it("counts every state that still needs the shop", async () => {
    for (const status of [
      OrderStatus.PAID,
      OrderStatus.SHOP_ACCEPTED,
      OrderStatus.QUEUED_FOR_PRINT,
      OrderStatus.PRINTING,
      OrderStatus.PRINTED,
      OrderStatus.READY_FOR_COLLECTION,
      OrderStatus.PRINT_FAILED,
      OrderStatus.PRINT_STATUS_UNKNOWN,
      OrderStatus.PAUSED,
      OrderStatus.QUALITY_CHECK,
    ]) {
      const branch = await fx.addBranch(`Busy ${status}`);
      await fx.makeOrder(1, 1, status, undefined, branch.id);
      const refused = await archive(branch.id);
      expect([status, refused.status, refused.body.error_code]).toEqual([
        status,
        409,
        "BRANCH_HAS_ORDERS",
      ]);
    }
  });
});
