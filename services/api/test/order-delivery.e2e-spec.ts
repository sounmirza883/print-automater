import { randomUUID } from "node:crypto";
import { OrderStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 21.5 (PRD 71): the optional delivery workflow on an order. */
describe("Order delivery (21.5, e2e)", () => {
  let fx: Fx;
  let other: Fx;
  let operatorToken: string;
  let counterToken: string;

  const ADDRESS = "House 12, Street 4, Model Town, Lahore";

  async function staff(f: Fx, role: UserRole): Promise<string> {
    const user = await f.prisma.user.create({
      data: {
        role,
        name: `delivery ${role}`,
        email: `delivery-${role}-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    f.userIds.push(user.id);
    await f.prisma.shopStaff.create({
      data: { shopId: f.shop.id, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
    });
    return f.app.get(TokenService).issueAccessToken(user);
  }

  beforeAll(async () => {
    fx = await createPhase19Fixture("delivery", { multiItemEnabled: false });
    other = await createPhase19Fixture("delivery-other", { multiItemEnabled: false });
    operatorToken = await staff(fx, UserRole.OPERATOR);
    counterToken = await staff(fx, UserRole.SHOP_COUNTER);
  });
  afterAll(async () => {
    await other?.cleanup();
    await fx?.cleanup();
  });

  const rows = (orderId: string) => fx.prisma.orderDelivery.findMany({ where: { orderId } });
  const put = (orderId: string, body: object, token = fx.token) =>
    request(fx.app.getHttpServer())
      .put(`/v1/shop/orders/${orderId}/delivery`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const setStatus = (orderId: string, body: object, token = fx.token) =>
    request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/delivery/status`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const readyOrder = async () =>
    (await fx.makeOrder(1, 1, OrderStatus.READY_FOR_COLLECTION)).orderId;

  it("records the delivery details (address, courier, tracking, fee), audited without the address, and shows on the order; the order's price and status are untouched", async () => {
    const orderId = await readyOrder();
    const before = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const res = await put(orderId, {
      address: ADDRESS,
      courier: "TCS",
      trackingNumber: "TCS-123",
      feeMinor: 300,
    }).expect(200);
    expect(res.body).toMatchObject({
      orderId,
      status: "PENDING",
      address: ADDRESS,
      courier: "TCS",
      trackingNumber: "TCS-123",
      feeMinor: 300,
      dispatchedAt: null,
      deliveredAt: null,
    });
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceId: res.body.id, action: "DELIVERY_DETAILS_SAVED" },
    });
    expect(audit?.actorId).toBe(fx.owner.id);
    expect(audit?.metadata).toMatchObject({
      orderId,
      courier: "TCS",
      feeMinor: 300,
      created: true,
    });
    // the address is personal data: it is never copied into the audit trail
    expect(JSON.stringify(audit?.metadata)).not.toContain("Model Town");

    const after = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.orderStatus).toBe(before.orderStatus);
    expect(after.pricingSnapshot).toEqual(before.pricingSnapshot);
    expect(after.paymentStatus).toBe(before.paymentStatus);

    const detail = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    expect(detail.body.delivery).toMatchObject({
      status: "PENDING",
      courier: "TCS",
      feeMinor: 300,
    });
    const got = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}/delivery`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    expect(got.body.id).toBe(res.body.id);
  });

  it("an order without delivery shows delivery: null, and GET delivery is 404 DELIVERY_NOT_FOUND", async () => {
    const orderId = await readyOrder();
    const detail = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    expect(detail.body.delivery).toBeNull();
    const res = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}/delivery`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(404);
    expect(res.body.error_code).toBe("DELIVERY_NOT_FOUND");
  });

  it("saving again updates the same record", async () => {
    const orderId = await readyOrder();
    const a = await put(orderId, { address: ADDRESS }).expect(200);
    const b = await put(orderId, { address: ADDRESS, courier: "Leopards", feeMinor: 150 }).expect(
      200,
    );
    expect(b.body.id).toBe(a.body.id);
    expect(b.body).toMatchObject({ courier: "Leopards", feeMinor: 150 });
    expect(await rows(orderId)).toHaveLength(1);
    const audits = await fx.prisma.auditLog.findMany({
      where: { resourceId: a.body.id, action: "DELIVERY_DETAILS_SAVED" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((x) => (x.metadata as { created: boolean }).created)).toEqual([true, false]);
  });

  it("concurrent first saves never 500 and leave exactly one record", async () => {
    const orderId = await readyOrder();
    const responses = await Promise.all(
      [0, 1, 2].map((i) => put(orderId, { address: ADDRESS, courier: `C${i}` })),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await rows(orderId)).toHaveLength(1);
  });

  it("walks PENDING -> OUT_FOR_DELIVERY -> DELIVERED with timestamps and audit; a delivered record is frozen", async () => {
    const orderId = await readyOrder();
    await put(orderId, { address: ADDRESS }).expect(200);

    const noCourier = await setStatus(orderId, { status: "OUT_FOR_DELIVERY" }).expect(409);
    expect(noCourier.body.error_code).toBe("DELIVERY_COURIER_REQUIRED");

    const out = await setStatus(orderId, {
      status: "OUT_FOR_DELIVERY",
      courier: "TCS",
      trackingNumber: "T-9",
    }).expect(200);
    expect(out.body).toMatchObject({
      status: "OUT_FOR_DELIVERY",
      courier: "TCS",
      trackingNumber: "T-9",
    });
    expect(out.body.dispatchedAt).not.toBeNull();

    const done = await setStatus(orderId, { status: "DELIVERED" }).expect(200);
    expect(done.body.status).toBe("DELIVERED");
    expect(done.body.deliveredAt).not.toBeNull();

    const audits = await fx.prisma.auditLog.findMany({
      where: { resourceId: done.body.id, action: "DELIVERY_STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((x) => (x.metadata as { to: string }).to)).toEqual([
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(audits[0]!.actorId).toBe(fx.owner.id);

    const frozen = await put(orderId, { address: "Elsewhere 1", courier: "X" }).expect(409);
    expect(frozen.body.error_code).toBe("DELIVERY_CLOSED");
    const back = await setStatus(orderId, { status: "FAILED" }).expect(409);
    expect(back.body.error_code).toBe("DELIVERY_STATUS_INVALID");
  });

  it("refuses skipping a step (PENDING -> DELIVERED) and allows a retry after FAILED", async () => {
    const orderId = await readyOrder();
    await put(orderId, { address: ADDRESS, courier: "TCS" }).expect(200);
    const skip = await setStatus(orderId, { status: "DELIVERED" }).expect(409);
    expect(skip.body.error_code).toBe("DELIVERY_STATUS_INVALID");
    await setStatus(orderId, { status: "OUT_FOR_DELIVERY" }).expect(200);
    await setStatus(orderId, { status: "FAILED" }).expect(200);
    await setStatus(orderId, { status: "OUT_FOR_DELIVERY" }).expect(200);
    await setStatus(orderId, { status: "DELIVERED" }).expect(200);
  });

  it("two concurrent status changes: exactly one wins, the other gets a clean 409", async () => {
    const orderId = await readyOrder();
    await put(orderId, { address: ADDRESS, courier: "TCS" }).expect(200);
    const responses = await Promise.all([
      setStatus(orderId, { status: "OUT_FOR_DELIVERY" }),
      setStatus(orderId, { status: "CANCELLED" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const [row] = await rows(orderId);
    expect(["OUT_FOR_DELIVERY", "CANCELLED"]).toContain(row!.status);
  });

  it("only orders that can still be delivered qualify: a cancelled order cannot get a delivery, and dispatch needs a READY/COMPLETED order", async () => {
    const cancelled = (await fx.makeOrder(1, 1, OrderStatus.CANCELLED)).orderId;
    const denied = await put(cancelled, { address: ADDRESS }).expect(409);
    expect(denied.body.error_code).toBe("DELIVERY_NOT_ALLOWED");
    expect(await rows(cancelled)).toHaveLength(0);

    const printing = (await fx.makeOrder(1, 1, OrderStatus.PRINTING)).orderId;
    await put(printing, { address: ADDRESS, courier: "TCS" }).expect(200);
    const early = await setStatus(printing, { status: "OUT_FOR_DELIVERY" }).expect(409);
    expect(early.body.error_code).toBe("DELIVERY_ORDER_NOT_READY");
  });

  it("validates input: address is required and bounded, fee is a non-negative whole number, status is from the list", async () => {
    const orderId = await readyOrder();
    await put(orderId, {}).expect(400);
    await put(orderId, { address: "x" }).expect(400);
    await put(orderId, { address: ADDRESS, feeMinor: -5 }).expect(400);
    await put(orderId, { address: ADDRESS, feeMinor: 1.5 }).expect(400);
    await put(orderId, { address: ADDRESS, courier: "c".repeat(101) }).expect(400);
    await setStatus(orderId, { status: "LOST" }).expect(400);
    await setStatus(orderId, { status: "PENDING" }).expect(400);
    expect(await rows(orderId)).toHaveLength(0);
  });

  it("MANAGE_DELIVERY is data: SHOP_COUNTER may manage it, OPERATOR may only read (403 on writes), another shop is denied, unauthenticated is 401", async () => {
    const orderId = await readyOrder();
    await put(orderId, { address: ADDRESS }, operatorToken).expect(403);
    await put(orderId, { address: ADDRESS }, counterToken).expect(200);
    await setStatus(orderId, { status: "CANCELLED" }, operatorToken).expect(403);
    await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}/delivery`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
    const denied = await put(orderId, { address: ADDRESS }, other.token);
    expect([403, 404]).toContain(denied.status);
    await request(fx.app.getHttpServer())
      .put(`/v1/shop/orders/${orderId}/delivery`)
      .send({ address: ADDRESS })
      .expect(401);
    const readDenied = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}/delivery`)
      .set("Authorization", `Bearer ${other.token}`);
    expect([403, 404]).toContain(readDenied.status);
  });

  it("21.8 data minimisation: roles without MANAGE_DELIVERY (operator) never receive the address, in the order detail, the order list or GET delivery; roles with it do", async () => {
    const orderId = await readyOrder();
    await put(orderId, {
      address: ADDRESS,
      courier: "TCS",
      trackingNumber: "T-1",
      feeMinor: 200,
    }).expect(200);
    const get = (path: string, token: string) =>
      request(fx.app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`).expect(200);

    for (const token of [operatorToken]) {
      const detail = await get(`/v1/shop/orders/${orderId}`, token);
      expect(detail.body.delivery).toMatchObject({
        status: "PENDING",
        courier: "TCS",
        feeMinor: 200,
        address: null,
        addressRedacted: true,
      });
      const direct = await get(`/v1/shop/orders/${orderId}/delivery`, token);
      expect(direct.body).toMatchObject({ address: null, addressRedacted: true, courier: "TCS" });
      const list = await get(`/v1/shop/orders?shopId=${fx.shop.id}`, token);
      const all = Object.values(list.body).flat() as Array<{ id: string; delivery: unknown }>;
      const listed = all.find((o) => o.id === orderId);
      expect(listed?.delivery).toMatchObject({ address: null, addressRedacted: true });
      expect(JSON.stringify(list.body)).not.toContain("Model Town");
    }
    for (const token of [counterToken, fx.token]) {
      const detail = await get(`/v1/shop/orders/${orderId}`, token);
      expect(detail.body.delivery).toMatchObject({ address: ADDRESS });
      expect(detail.body.delivery.addressRedacted).toBeUndefined();
      const direct = await get(`/v1/shop/orders/${orderId}/delivery`, token);
      expect(direct.body.address).toBe(ADDRESS);
    }
  });
});
