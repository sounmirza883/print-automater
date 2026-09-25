import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.2: the inventory HTTP surface -- CRUD, movements, permissions (data in
 * ROLE_PERMISSIONS), tenant isolation via ShopScopeGuard, pagination. */
describe("Inventory API (20.2, e2e)", () => {
  let fx: InventoryFixture;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    fx = await createInventoryFixture("inv-api");
    // Listen once: with an un-listening app supertest starts and CLOSES a server per
    // request, so concurrent requests reset each other (ECONNRESET).
    await fx.app.listen(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  async function createItem(body: Record<string, unknown> = {}, token = fx.token) {
    return http()
      .post("/v1/shop/inventory/items")
      .set(as(token))
      .send({ shopId: fx.shop.id, name: "A4 80gsm white", paperSize: "A4", ...body });
  }

  describe("items", () => {
    it("creates an item; initialQuantity is recorded as an audited ADJUSTMENT movement, never a bare column write", async () => {
      const res = await createItem({
        sku: "A4-80-W",
        paperType: "STANDARD",
        weightGsm: 80,
        minQuantity: 100,
        maxQuantity: 5000,
        location: "Shelf 2",
        unitCostMinor: 3,
        initialQuantity: 500,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        shopId: fx.shop.id,
        name: "A4 80gsm white",
        sku: "A4-80-W",
        paperSize: "A4",
        paperType: "STANDARD",
        weightGsm: 80,
        quantity: 500,
        minQuantity: 100,
        maxQuantity: 5000,
        location: "Shelf 2",
        unitCostMinor: 3,
        active: true,
        lowStock: false,
      });
      const movements = await fx.prisma.inventoryMovement.findMany({
        where: { inventoryItemId: res.body.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: "ADJUSTMENT",
        quantityDelta: 500,
        quantityAfter: 500,
        actorId: fx.owner.id,
      });
      const audit = await fx.prisma.auditLog.findMany({
        where: {
          resourceId: res.body.id,
          action: { in: ["INVENTORY_ITEM_CREATED", "INVENTORY_MOVEMENT"] },
        },
      });
      expect(audit.map((a) => a.action).sort()).toEqual([
        "INVENTORY_ITEM_CREATED",
        "INVENTORY_MOVEMENT",
      ]);
    });

    it("rejects a duplicate SKU within a shop (409) but allows the same SKU in another shop", async () => {
      expect((await createItem({ sku: "DUP-1" })).status).toBe(201);
      const dup = await createItem({ sku: "DUP-1" });
      expect(dup.status).toBe(409);
      expect(dup.body.error_code).toBe("INVENTORY_SKU_TAKEN");
      await http()
        .post("/v1/shop/inventory/items")
        .set(as(fx.ownerB.token))
        .send({ shopId: fx.shopB.id, name: "B item", sku: "DUP-1" })
        .expect(201);
    });

    it("validates input: unknown paper size, max below min, negative quantities", async () => {
      expect((await createItem({ paperSize: "A0" })).status).toBe(400);
      expect((await createItem({ minQuantity: 10, maxQuantity: 5 })).status).toBe(400);
      expect((await createItem({ initialQuantity: -1 })).status).toBe(400);
      expect((await createItem({ name: "" })).status).toBe(400);
    });

    it("reads one item and updates its metadata but never its quantity", async () => {
      const created = (await createItem({ initialQuantity: 10 })).body;
      const got = await http().get(`/v1/shop/inventory/items/${created.id}`).set(as(fx.token));
      expect(got.status).toBe(200);
      expect(got.body.quantity).toBe(10);

      const patched = await http()
        .patch(`/v1/shop/inventory/items/${created.id}`)
        .set(as(fx.token))
        .send({ name: "Renamed", minQuantity: 20, location: null, active: false });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({
        name: "Renamed",
        minQuantity: 20,
        location: null,
        active: false,
        quantity: 10,
        lowStock: true,
      });
      // quantity is not an editable field: it is rejected, not silently ignored
      const sneaky = await http()
        .patch(`/v1/shop/inventory/items/${created.id}`)
        .set(as(fx.token))
        .send({ quantity: 9999 });
      expect(sneaky.status).toBe(400);
      expect(
        (await fx.prisma.inventoryItem.findUniqueOrThrow({ where: { id: created.id } })).quantity,
      ).toBe(10);
    });

    it("a patch that would put max below the stored min is refused", async () => {
      const created = (await createItem({ minQuantity: 50 })).body;
      const res = await http()
        .patch(`/v1/shop/inventory/items/${created.id}`)
        .set(as(fx.token))
        .send({ maxQuantity: 10 });
      expect(res.status).toBe(400);
    });
  });

  describe("list + pagination", () => {
    beforeAll(async () => {
      // A dedicated shop's worth of predictable rows.
      for (let i = 0; i < 7; i += 1) {
        await fx.prisma.inventoryItem.create({
          data: {
            shopId: fx.shopB.id,
            name: `Page item ${String(i).padStart(2, "0")}`,
            paperSize: i % 2 === 0 ? "A4" : "A3",
            quantity: i,
            minQuantity: i === 1 ? 5 : 0,
          },
        });
      }
    });

    const list = (query: Record<string, string | number>) =>
      http()
        .get("/v1/shop/inventory/items")
        .query({ shopId: fx.shopB.id, ...query })
        .set(as(fx.ownerB.token));

    it("returns {items,total,limit,offset}, ordered by name, honouring limit/offset", async () => {
      const first = await list({ limit: 3, offset: 0 });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ total: expect.any(Number), limit: 3, offset: 0 });
      expect(first.body.items).toHaveLength(3);
      const second = await list({ limit: 3, offset: 3 });
      const names = [...first.body.items, ...second.body.items].map(
        (i: { name: string }) => i.name,
      );
      expect(new Set(names).size).toBe(6);
      expect([...names].sort()).toEqual(names);
    });

    it("caps the page size (limit above 100 is a 400) and defaults to 50", async () => {
      expect((await list({ limit: 101 })).status).toBe(400);
      expect((await list({})).body.limit).toBe(50);
    });

    it("filters by search, paperSize, lowStock and active", async () => {
      expect((await list({ search: "item 03" })).body.items).toHaveLength(1);
      const a3 = (await list({ paperSize: "A3" })).body.items as Array<{ paperSize: string }>;
      expect(a3.length).toBeGreaterThan(0);
      expect(a3.every((i) => i.paperSize === "A3")).toBe(true);
      const low = (await list({ lowStock: "true" })).body.items as Array<{
        name: string;
        lowStock: boolean;
      }>;
      expect(low.map((i) => i.name)).toEqual(["Page item 01"]);
      expect(low[0]!.lowStock).toBe(true);
    });
  });

  describe("movements", () => {
    it("records a manual movement atomically and returns the movement and the item", async () => {
      const item = (await createItem({ initialQuantity: 100 })).body;
      const res = await http()
        .post(`/v1/shop/inventory/items/${item.id}/movements`)
        .set(as(fx.token))
        .send({ type: "PURCHASE", quantityDelta: 50, reason: "Delivery" });
      expect(res.status).toBe(201);
      expect(res.body.movement).toMatchObject({
        type: "PURCHASE",
        quantityDelta: 50,
        quantityAfter: 150,
        reason: "Delivery",
      });
      expect(res.body.item.quantity).toBe(150);
      const consume = await http()
        .post(`/v1/shop/inventory/items/${item.id}/movements`)
        .set(as(fx.token))
        .send({ type: "CONSUMPTION", quantityDelta: -30 });
      expect(consume.body.item.quantity).toBe(120);
    });

    it("enforces the sign rules per type and requires a reason for adjustments/corrections", async () => {
      const item = (await createItem({ initialQuantity: 10 })).body;
      const post = (body: Record<string, unknown>) =>
        http().post(`/v1/shop/inventory/items/${item.id}/movements`).set(as(fx.token)).send(body);
      expect((await post({ type: "PURCHASE", quantityDelta: -1 })).status).toBe(400);
      expect((await post({ type: "RETURN", quantityDelta: -1 })).status).toBe(400);
      expect((await post({ type: "CONSUMPTION", quantityDelta: 1 })).status).toBe(400);
      expect((await post({ type: "ADJUSTMENT", quantityDelta: 1 })).status).toBe(400); // no reason
      expect((await post({ type: "CORRECTION", quantityDelta: 0, reason: "x" })).status).toBe(400);
      expect(
        (await post({ type: "CORRECTION", quantityDelta: -2, reason: "recount" })).status,
      ).toBe(201);
    });

    it("refuses to overdraw with 409 INSUFFICIENT_STOCK and leaves the stock alone", async () => {
      const item = (await createItem({ initialQuantity: 5 })).body;
      const res = await http()
        .post(`/v1/shop/inventory/items/${item.id}/movements`)
        .set(as(fx.token))
        .send({ type: "CONSUMPTION", quantityDelta: -6 });
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("INSUFFICIENT_STOCK");
      expect(
        (await http().get(`/v1/shop/inventory/items/${item.id}`).set(as(fx.token))).body.quantity,
      ).toBe(5);
    });

    it("concurrent HTTP consumptions never oversell", async () => {
      const item = (await createItem({ initialQuantity: 6 })).body;
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          http()
            .post(`/v1/shop/inventory/items/${item.id}/movements`)
            .set(as(fx.token))
            .send({ type: "CONSUMPTION", quantityDelta: -1 }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(6);
      expect(results.filter((r) => r.status === 409)).toHaveLength(9);
      expect(
        (await http().get(`/v1/shop/inventory/items/${item.id}`).set(as(fx.token))).body.quantity,
      ).toBe(0);
    });

    it("an Idempotency-Key replay returns the first response and moves stock once", async () => {
      const item = (await createItem({ initialQuantity: 10 })).body;
      const send = () =>
        http()
          .post(`/v1/shop/inventory/items/${item.id}/movements`)
          .set(as(fx.token))
          .set("Idempotency-Key", `inv-${item.id}`)
          .send({ type: "CONSUMPTION", quantityDelta: -4 });
      const first = await send();
      const replay = await send();
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.movement.id).toBe(first.body.movement.id);
      expect(
        (await http().get(`/v1/shop/inventory/items/${item.id}`).set(as(fx.token))).body.quantity,
      ).toBe(6);
    });

    it("lists an item's movements newest first with pagination", async () => {
      const item = (await createItem({ initialQuantity: 10 })).body;
      for (let i = 0; i < 4; i += 1) {
        await http()
          .post(`/v1/shop/inventory/items/${item.id}/movements`)
          .set(as(fx.token))
          .send({ type: "CONSUMPTION", quantityDelta: -1 })
          .expect(201);
      }
      const page = await http()
        .get(`/v1/shop/inventory/items/${item.id}/movements`)
        .query({ limit: 2, offset: 0 })
        .set(as(fx.token));
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ total: 5, limit: 2, offset: 0 });
      expect(page.body.items).toHaveLength(2);
      expect(page.body.items[0].quantityAfter).toBe(6);
      expect(page.body.items[1].quantityAfter).toBe(7);
    });
  });

  describe("permissions and tenant isolation", () => {
    it("VIEW_INVENTORY: operator and manager can read, counter cannot (403)", async () => {
      const item = (await createItem({ initialQuantity: 1 })).body;
      for (const t of [fx.operator.token, fx.manager.token, fx.token]) {
        expect((await http().get(`/v1/shop/inventory/items/${item.id}`).set(as(t))).status).toBe(
          200,
        );
      }
      expect(
        (await http().get(`/v1/shop/inventory/items/${item.id}`).set(as(fx.counter.token))).status,
      ).toBe(403);
      expect(
        (
          await http()
            .get("/v1/shop/inventory/items")
            .query({ shopId: fx.shop.id })
            .set(as(fx.counter.token))
        ).status,
      ).toBe(403);
    });

    it("MANAGE_INVENTORY: operator cannot create, edit or move stock (403), manager and owner can", async () => {
      const item = (await createItem({ initialQuantity: 5 })).body;
      const op = as(fx.operator.token);
      expect(
        (
          await http()
            .post("/v1/shop/inventory/items")
            .set(op)
            .send({ shopId: fx.shop.id, name: "x" })
        ).status,
      ).toBe(403);
      expect(
        (await http().patch(`/v1/shop/inventory/items/${item.id}`).set(op).send({ name: "y" }))
          .status,
      ).toBe(403);
      expect(
        (
          await http()
            .post(`/v1/shop/inventory/items/${item.id}/movements`)
            .set(op)
            .send({ type: "PURCHASE", quantityDelta: 1 })
        ).status,
      ).toBe(403);
      expect(
        (
          await http()
            .post(`/v1/shop/inventory/items/${item.id}/movements`)
            .set(as(fx.manager.token))
            .send({ type: "PURCHASE", quantityDelta: 1 })
        ).status,
      ).toBe(201);
    });

    it("another shop's staff can neither see nor touch this shop's items (403 on every route)", async () => {
      const item = (await createItem({ initialQuantity: 5 })).body;
      const b = as(fx.ownerB.token);
      expect((await http().get(`/v1/shop/inventory/items/${item.id}`).set(b)).status).toBe(403);
      expect(
        (await http().patch(`/v1/shop/inventory/items/${item.id}`).set(b).send({ name: "hijack" }))
          .status,
      ).toBe(403);
      expect(
        (
          await http()
            .post(`/v1/shop/inventory/items/${item.id}/movements`)
            .set(b)
            .send({ type: "PURCHASE", quantityDelta: 1 })
        ).status,
      ).toBe(403);
      expect(
        (await http().get(`/v1/shop/inventory/items/${item.id}/movements`).set(b)).status,
      ).toBe(403);
      // listing / creating against shop A's id
      expect(
        (await http().get("/v1/shop/inventory/items").query({ shopId: fx.shop.id }).set(b)).status,
      ).toBe(403);
      expect(
        (
          await http()
            .post("/v1/shop/inventory/items")
            .set(b)
            .send({ shopId: fx.shop.id, name: "x" })
        ).status,
      ).toBe(403);
      expect(
        (await fx.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).name,
      ).toBe("A4 80gsm white");
    });

    it("a listing for shop B never contains shop A's items", async () => {
      expect((await createItem({ name: "Only in A" })).status).toBe(201);
      const res = await http()
        .get("/v1/shop/inventory/items")
        .query({ shopId: fx.shopB.id })
        .set(as(fx.ownerB.token));
      expect(res.body.items.some((i: { name: string }) => i.name === "Only in A")).toBe(false);
      expect(res.body.items.every((i: { shopId: string }) => i.shopId === fx.shopB.id)).toBe(true);
    });

    it("a customer and an unauthenticated caller are refused", async () => {
      expect(
        (await http().get("/v1/shop/inventory/items").query({ shopId: fx.shop.id })).status,
      ).toBe(401);
      const customerToken = fx.tokens.issueAccessToken(fx.customer);
      expect(
        (
          await http()
            .get("/v1/shop/inventory/items")
            .query({ shopId: fx.shop.id })
            .set(as(customerToken))
        ).status,
      ).toBe(403);
    });
  });
});
