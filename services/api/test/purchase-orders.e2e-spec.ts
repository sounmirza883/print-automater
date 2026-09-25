import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.7 (PRD 31): purchase orders; receiving goods creates inventory movements
 * atomically and idempotently. */
describe("Purchase orders (20.7, e2e)", () => {
  let fx: InventoryFixture;
  let supplierId: string;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    fx = await createInventoryFixture("po", { multiItemEnabled: true, documentPages: 5 });
    supplierId = (
      await fx.prisma.supplier.create({ data: { shopId: fx.shop.id, name: "Paper Co" } })
    ).id;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const makeItem = (quantity = 0, extra: object = {}) =>
    fx.prisma.inventoryItem.create({
      data: {
        shopId: fx.shop.id,
        name: `it-${Math.random()}`,
        paperSize: "A4",
        quantity,
        ...extra,
      },
    });
  const qty = async (id: string) =>
    (await fx.prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).quantity;

  async function createPo(
    lines: Array<{ inventoryItemId: string; quantity: number; unitCostMinor?: number }>,
    token = fx.token,
    extra: Record<string, unknown> = {},
  ) {
    return http()
      .post("/v1/shop/purchase-orders")
      .set(as(token))
      .send({ shopId: fx.shop.id, supplierId, lines, ...extra });
  }
  const action = (id: string, name: string, body: object = {}, token = fx.token) =>
    http().post(`/v1/shop/purchase-orders/${id}/${name}`).set(as(token)).send(body);
  async function orderedPo(
    lines: Array<{ inventoryItemId: string; quantity: number; unitCostMinor?: number }>,
  ) {
    const po = (await createPo(lines)).body;
    expect((await action(po.id, "order")).status).toBe(200);
    return po as { id: string; lines: Array<{ id: string; inventoryItemId: string }> };
  }

  describe("create and lifecycle", () => {
    it("creates a DRAFT with a PO number, lines, total cost and UNPAID payment status", async () => {
      const a = await makeItem();
      const b = await makeItem();
      const res = await createPo(
        [
          { inventoryItemId: a.id, quantity: 100, unitCostMinor: 12 },
          { inventoryItemId: b.id, quantity: 50, unitCostMinor: 20 },
        ],
        fx.token,
        { expectedDeliveryAt: "2026-12-01T00:00:00.000Z", notes: "Rush" },
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        shopId: fx.shop.id,
        supplierId,
        status: "DRAFT",
        paymentStatus: "UNPAID",
        totalCostMinor: 100 * 12 + 50 * 20,
        notes: "Rush",
        actualDeliveryAt: null,
      });
      expect(res.body.poNumber).toMatch(/^PO-\d{6}$/);
      expect(res.body.lines).toHaveLength(2);
      const second = await createPo([{ inventoryItemId: a.id, quantity: 1 }]);
      expect(second.body.poNumber).not.toBe(res.body.poNumber);
    });

    it("defaults a line's cost from the supplier's price, else the item's unit cost, else 0", async () => {
      const priced = await makeItem(0, { unitCostMinor: 7 });
      const linked = await makeItem(0, { unitCostMinor: 7 });
      const bare = await makeItem();
      await fx.prisma.supplierProduct.create({
        data: { shopId: fx.shop.id, supplierId, inventoryItemId: linked.id, unitPriceMinor: 5 },
      });
      const res = await createPo([
        { inventoryItemId: priced.id, quantity: 10 },
        { inventoryItemId: linked.id, quantity: 10 },
        { inventoryItemId: bare.id, quantity: 10 },
      ]);
      const cost = (itemId: string) =>
        res.body.lines.find((l: { inventoryItemId: string }) => l.inventoryItemId === itemId)
          .unitCostMinor;
      expect([cost(priced.id), cost(linked.id), cost(bare.id)]).toEqual([7, 5, 0]);
      expect(res.body.totalCostMinor).toBe(120);
    });

    it("validates: no lines, duplicate item, zero quantity; another shop's item or supplier is 404", async () => {
      const a = await makeItem();
      expect((await createPo([])).status).toBe(400);
      expect(
        (
          await createPo([
            { inventoryItemId: a.id, quantity: 1 },
            { inventoryItemId: a.id, quantity: 2 },
          ])
        ).status,
      ).toBe(400);
      expect((await createPo([{ inventoryItemId: a.id, quantity: 0 }])).status).toBe(400);
      const foreign = await fx.prisma.inventoryItem.create({
        data: { shopId: fx.shopB.id, name: "B" },
      });
      expect((await createPo([{ inventoryItemId: foreign.id, quantity: 1 }])).status).toBe(404);
      const foreignSupplier = await fx.prisma.supplier.create({
        data: { shopId: fx.shopB.id, name: "B sup" },
      });
      const res = await http()
        .post("/v1/shop/purchase-orders")
        .set(as(fx.token))
        .send({
          shopId: fx.shop.id,
          supplierId: foreignSupplier.id,
          lines: [{ inventoryItemId: a.id, quantity: 1 }],
        });
      expect(res.status).toBe(404);
    });

    it("DRAFT -> ORDERED -> RECEIVED; illegal moves are 409 (receive a DRAFT, order twice, cancel a RECEIVED)", async () => {
      const a = await makeItem();
      const po = (await createPo([{ inventoryItemId: a.id, quantity: 10 }])).body;
      expect((await action(po.id, "receive")).status).toBe(409);
      expect((await action(po.id, "order")).body).toMatchObject({ status: "ORDERED" });
      const again = await action(po.id, "order");
      expect(again.status).toBe(409);
      expect(again.body.error_code).toBe("PURCHASE_ORDER_INVALID_STATE");
      expect((await action(po.id, "receive")).body).toMatchObject({ status: "RECEIVED" });
      expect((await action(po.id, "cancel")).status).toBe(409);
    });

    it("cancel works from DRAFT and ORDERED, and a cancelled PO can never be received", async () => {
      const a = await makeItem();
      const d = (await createPo([{ inventoryItemId: a.id, quantity: 10 }])).body;
      expect((await action(d.id, "cancel")).body.status).toBe("CANCELLED");
      const o = await orderedPo([{ inventoryItemId: a.id, quantity: 10 }]);
      expect((await action(o.id, "cancel")).body.status).toBe("CANCELLED");
      expect((await action(o.id, "receive")).status).toBe(409);
      expect(await qty(a.id)).toBe(0);
    });

    it("payment status moves independently of delivery, and only to a valid value", async () => {
      const a = await makeItem();
      const po = (await createPo([{ inventoryItemId: a.id, quantity: 1 }])).body;
      const res = await http()
        .patch(`/v1/shop/purchase-orders/${po.id}/payment`)
        .set(as(fx.token))
        .send({ paymentStatus: "PAID" });
      expect(res.status).toBe(200);
      expect(res.body.paymentStatus).toBe("PAID");
      expect(
        (
          await http()
            .patch(`/v1/shop/purchase-orders/${po.id}/payment`)
            .set(as(fx.token))
            .send({ paymentStatus: "MAYBE" })
        ).status,
      ).toBe(400);
    });

    it("PATCH edits notes and expected delivery; lists are paginated and filterable; GET returns the lines", async () => {
      const a = await makeItem();
      const po = (await createPo([{ inventoryItemId: a.id, quantity: 1 }])).body;
      const patched = await http()
        .patch(`/v1/shop/purchase-orders/${po.id}`)
        .set(as(fx.token))
        .send({ notes: "Updated", expectedDeliveryAt: "2027-01-01T00:00:00.000Z" });
      expect(patched.body).toMatchObject({ notes: "Updated" });
      expect(patched.body.expectedDeliveryAt).toBe("2027-01-01T00:00:00.000Z");
      const got = await http().get(`/v1/shop/purchase-orders/${po.id}`).set(as(fx.token));
      expect(got.body.lines).toHaveLength(1);
      const page = await http()
        .get("/v1/shop/purchase-orders")
        .query({ shopId: fx.shop.id, limit: 2 })
        .set(as(fx.token));
      expect(page.body).toMatchObject({ limit: 2, offset: 0 });
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      expect(page.body.total).toBeGreaterThan(2);
      const drafts = await http()
        .get("/v1/shop/purchase-orders")
        .query({ shopId: fx.shop.id, status: "DRAFT" })
        .set(as(fx.token));
      expect(drafts.body.items.every((p: { status: string }) => p.status === "DRAFT")).toBe(true);
      expect(
        (
          await http()
            .get("/v1/shop/purchase-orders")
            .query({ shopId: fx.shop.id, limit: 101 })
            .set(as(fx.token))
        ).status,
      ).toBe(400);
    });
  });

  describe("receiving goods", () => {
    it("adds every line to stock as a PURCHASE movement (audited), records the delivery, and sets received quantities", async () => {
      const a = await makeItem(5);
      const b = await makeItem(0);
      const po = await orderedPo([
        { inventoryItemId: a.id, quantity: 100 },
        { inventoryItemId: b.id, quantity: 40 },
      ]);
      const res = await action(po.id, "receive");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("RECEIVED");
      expect(res.body.actualDeliveryAt).not.toBeNull();
      expect(
        res.body.lines
          .map((l: { quantityReceived: number }) => l.quantityReceived)
          .sort((x: number, y: number) => x - y),
      ).toEqual([40, 100]);
      expect(await qty(a.id)).toBe(105);
      expect(await qty(b.id)).toBe(40);
      const moves = await fx.prisma.inventoryMovement.findMany({
        where: { inventoryItemId: { in: [a.id, b.id] } },
        orderBy: { createdAt: "asc" },
      });
      expect(moves).toHaveLength(2);
      expect(moves.every((m) => m.type === "PURCHASE" && m.actorId === fx.owner.id)).toBe(true);
      expect(moves.map((m) => m.idempotencyKey).sort()).toEqual(
        po.lines.map((l) => `po-receipt:${l.id}`).sort(),
      );
      const audits = await fx.prisma.auditLog.findMany({
        where: { resourceId: { in: [a.id, b.id] }, action: "INVENTORY_MOVEMENT" },
      });
      expect(audits).toHaveLength(2);
      expect(
        await fx.prisma.auditLog.count({
          where: { resourceId: po.id, action: "PURCHASE_ORDER_RECEIVED" },
        }),
      ).toBe(1);
    });

    it("a partial delivery: per-line quantities (short, over, zero) are honoured; unlisted lines default to ordered", async () => {
      const a = await makeItem();
      const b = await makeItem();
      const c = await makeItem();
      const po = await orderedPo([
        { inventoryItemId: a.id, quantity: 100 },
        { inventoryItemId: b.id, quantity: 100 },
        { inventoryItemId: c.id, quantity: 100 },
      ]);
      const line = (id: string) => po.lines.find((l) => l.inventoryItemId === id)!.id;
      const res = await action(po.id, "receive", {
        lines: [
          { lineId: line(a.id), quantityReceived: 60 },
          { lineId: line(b.id), quantityReceived: 0 },
        ],
      });
      expect(res.status).toBe(200);
      expect([await qty(a.id), await qty(b.id), await qty(c.id)]).toEqual([60, 0, 100]);
      // a zero-received line writes no movement
      expect(await fx.prisma.inventoryMovement.count({ where: { inventoryItemId: b.id } })).toBe(0);
    });

    it("rejects a received line that is not on this PO (400) and applies nothing", async () => {
      const a = await makeItem();
      const other = await orderedPo([{ inventoryItemId: (await makeItem()).id, quantity: 5 }]);
      const po = await orderedPo([{ inventoryItemId: a.id, quantity: 10 }]);
      const res = await action(po.id, "receive", {
        lines: [{ lineId: other.lines[0]!.id, quantityReceived: 5 }],
      });
      expect(res.status).toBe(400);
      expect(await qty(a.id)).toBe(0);
      expect(
        (await fx.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status,
      ).toBe("ORDERED");
    });

    it("a sequential second receive is an idempotent replay: 200, same PO, stock NOT counted twice", async () => {
      const a = await makeItem();
      const po = await orderedPo([{ inventoryItemId: a.id, quantity: 25 }]);
      const first = await action(po.id, "receive");
      const replay = await action(po.id, "receive", {
        lines: [{ lineId: po.lines[0]!.id, quantityReceived: 999 }],
      });
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe("RECEIVED");
      expect(await qty(a.id)).toBe(25);
      expect(await fx.prisma.inventoryMovement.count({ where: { inventoryItemId: a.id } })).toBe(1);
    });

    it("DOUBLE RECEIVE with Promise.all never double-counts: 6 simultaneous receives -> stock counted exactly once, one movement per line", async () => {
      for (let round = 0; round < 5; round += 1) {
        const a = await makeItem(10);
        const b = await makeItem(0);
        const po = await orderedPo([
          { inventoryItemId: a.id, quantity: 100 },
          { inventoryItemId: b.id, quantity: 30 },
        ]);
        const results = await Promise.all(
          Array.from({ length: 6 }, () => action(po.id, "receive")),
        );
        expect(results.every((r) => r.status === 200)).toBe(true);
        expect(results.every((r) => r.body.status === "RECEIVED")).toBe(true);
        expect(await qty(a.id)).toBe(110);
        expect(await qty(b.id)).toBe(30);
        expect(
          await fx.prisma.inventoryMovement.count({
            where: { inventoryItemId: { in: [a.id, b.id] } },
          }),
        ).toBe(2);
        expect(
          await fx.prisma.auditLog.count({
            where: { resourceId: po.id, action: "PURCHASE_ORDER_RECEIVED" },
          }),
        ).toBe(1);
      }
    });

    it("receive racing cancel: exactly one wins and the stock agrees with the winner", async () => {
      for (let round = 0; round < 5; round += 1) {
        const a = await makeItem();
        const po = await orderedPo([{ inventoryItemId: a.id, quantity: 10 }]);
        const [recv, cancel] = await Promise.all([
          action(po.id, "receive"),
          action(po.id, "cancel"),
        ]);
        const final = (await fx.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } }))
          .status;
        if (final === "RECEIVED") {
          expect(recv.status).toBe(200);
          expect(cancel.status).toBe(409);
          expect(await qty(a.id)).toBe(10);
        } else {
          expect(final).toBe("CANCELLED");
          expect(recv.status).toBe(409);
          expect(cancel.status).toBe(200);
          expect(await qty(a.id)).toBe(0);
        }
      }
    });

    it("two POs for the same item received at once sum exactly (no lost update)", async () => {
      const a = await makeItem(0);
      const pos = await Promise.all(
        Array.from({ length: 5 }, () => orderedPo([{ inventoryItemId: a.id, quantity: 20 }])),
      );
      await Promise.all(pos.map((po) => action(po.id, "receive")));
      expect(await qty(a.id)).toBe(100);
      expect(await fx.prisma.inventoryMovement.count({ where: { inventoryItemId: a.id } })).toBe(5);
    });

    it("is atomic: when a later line cannot be applied the whole receipt rolls back (PO stays ORDERED, no stock moved, no movements, no audit)", async () => {
      const ids = [(await makeItem()).id, (await makeItem()).id].sort();
      const first = ids[0]!;
      const second = ids[1]!;
      // Lines are applied in ascending item id; make the SECOND overflow the integer column.
      await fx.prisma.inventoryItem.update({
        where: { id: second },
        data: { quantity: 2_147_483_600 },
      });
      const po = await orderedPo([
        { inventoryItemId: first, quantity: 10 },
        { inventoryItemId: second, quantity: 100 },
      ]);
      const res = await action(po.id, "receive");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await qty(first)).toBe(0);
      expect(await qty(second)).toBe(2_147_483_600);
      expect(
        await fx.prisma.inventoryMovement.count({
          where: { inventoryItemId: { in: [first, second] } },
        }),
      ).toBe(0);
      expect(
        (await fx.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status,
      ).toBe("ORDERED");
      expect(
        await fx.prisma.auditLog.count({
          where: { resourceId: po.id, action: "PURCHASE_ORDER_RECEIVED" },
        }),
      ).toBe(0);
    });

    it("a line whose receipt key already exists is treated as already applied (never applied twice); the other lines still apply", async () => {
      const ids = [(await makeItem()).id, (await makeItem()).id].sort();
      const po = await orderedPo([
        { inventoryItemId: ids[0]!, quantity: 10 },
        { inventoryItemId: ids[1]!, quantity: 10 },
      ]);
      const preApplied = po.lines.find((l) => l.inventoryItemId === ids[1])!;
      await fx.prisma.inventoryItem.update({ where: { id: ids[1]! }, data: { quantity: 10 } });
      await fx.prisma.inventoryMovement.create({
        data: {
          shopId: fx.shop.id,
          inventoryItemId: ids[1]!,
          type: "PURCHASE",
          quantityDelta: 10,
          quantityAfter: 10,
          idempotencyKey: `po-receipt:${preApplied.id}`,
        },
      });
      const res = await action(po.id, "receive");
      expect(res.status).toBe(200);
      expect(await qty(ids[0]!)).toBe(10);
      expect(await qty(ids[1]!)).toBe(10); // not 20
    });
  });

  describe("receiving unblocks paper-blocked work", () => {
    it("with tracking and recovery opted in, receiving paper re-allocates a NO_PAPER job", async () => {
      // its own shop: the main fixture shop holds A4 stock from the other tests
      const own = await createInventoryFixture("po-paper", {
        multiItemEnabled: true,
        documentPages: 5,
      });
      try {
        await own.makePrinter("PO printer");
        await own.prisma.shop.update({
          where: { id: own.shop.id },
          data: { inventoryTrackingEnabled: true, autoFailoverEnabled: true },
        });
        const sup = await own.prisma.supplier.create({ data: { shopId: own.shop.id, name: "S" } });
        const paper = await own.prisma.inventoryItem.create({
          data: { shopId: own.shop.id, name: "A4", paperSize: "A4", paperType: "STANDARD" },
        });
        const call = (m: "get" | "post", path: string) =>
          request(own.app.getHttpServer())[m](path).set(as(own.token));
        const { orderId } = await own.makeOrder(1);
        expect((await call("post", `/v1/shop/orders/${orderId}/accept`)).status).toBe(200);
        const blocked = await own.prisma.printJob.findFirstOrThrow({ where: { orderId } });
        expect(blocked.blockedReason).toBe("NO_PAPER");

        const po = (
          await call("post", "/v1/shop/purchase-orders").send({
            shopId: own.shop.id,
            supplierId: sup.id,
            lines: [{ inventoryItemId: paper.id, quantity: 500 }],
          })
        ).body;
        expect((await call("post", `/v1/shop/purchase-orders/${po.id}/order`)).status).toBe(200);
        expect((await call("post", `/v1/shop/purchase-orders/${po.id}/receive`)).status).toBe(200);
        const after = await own.prisma.printJob.findUniqueOrThrow({ where: { id: blocked.id } });
        expect(after.status).toBe("QUEUED");
      } finally {
        await own.cleanup();
      }
    });
  });

  describe("permissions and tenant isolation", () => {
    it("MANAGE_INVENTORY: manager and owner yes; operator and counter 403 on every route", async () => {
      const a = await makeItem();
      const po = (await createPo([{ inventoryItemId: a.id, quantity: 1 }], fx.manager.token)).body;
      expect(po.status).toBe("DRAFT");
      for (const t of [fx.operator.token, fx.counter.token]) {
        expect((await createPo([{ inventoryItemId: a.id, quantity: 1 }], t)).status).toBe(403);
        expect(
          (await http().get("/v1/shop/purchase-orders").query({ shopId: fx.shop.id }).set(as(t)))
            .status,
        ).toBe(403);
        expect((await http().get(`/v1/shop/purchase-orders/${po.id}`).set(as(t))).status).toBe(403);
        for (const name of ["order", "receive", "cancel"]) {
          expect((await action(po.id, name, {}, t)).status).toBe(403);
        }
      }
      expect(
        (await http().get("/v1/shop/purchase-orders").query({ shopId: fx.shop.id })).status,
      ).toBe(401);
    });

    it("another shop's owner gets 403 everywhere and can never move this shop's stock by receiving", async () => {
      const a = await makeItem();
      const po = await orderedPo([{ inventoryItemId: a.id, quantity: 10 }]);
      const b = fx.ownerB.token;
      expect((await http().get(`/v1/shop/purchase-orders/${po.id}`).set(as(b))).status).toBe(403);
      expect(
        (await http().patch(`/v1/shop/purchase-orders/${po.id}`).set(as(b)).send({ notes: "x" }))
          .status,
      ).toBe(403);
      expect(
        (
          await http()
            .patch(`/v1/shop/purchase-orders/${po.id}/payment`)
            .set(as(b))
            .send({ paymentStatus: "PAID" })
        ).status,
      ).toBe(403);
      for (const name of ["order", "receive", "cancel"]) {
        expect((await action(po.id, name, {}, b)).status).toBe(403);
      }
      expect(
        (await http().get("/v1/shop/purchase-orders").query({ shopId: fx.shop.id }).set(as(b)))
          .status,
      ).toBe(403);
      expect((await createPo([{ inventoryItemId: a.id, quantity: 1 }], b)).status).toBe(403);
      expect(await qty(a.id)).toBe(0);
      expect(
        (await fx.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status,
      ).toBe("ORDERED");
    });
  });
});
