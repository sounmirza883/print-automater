import request from "supertest";
import { syncLowStockAlerts } from "@print-automated/backend-shared";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.5: the API surface of the low-stock feature (alerts list + dashboard aggregate). */
describe("Inventory alerts API (20.5, e2e)", () => {
  let fx: InventoryFixture;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    fx = await createInventoryFixture("inv-alerts");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const item = (quantity: number, minQuantity: number, extra: object = {}) =>
    fx.prisma.inventoryItem.create({
      data: {
        shopId: fx.shop.id,
        name: `it-${Math.random()}`,
        paperSize: "A4",
        quantity,
        minQuantity,
        ...extra,
      },
    });

  it("summary is live and counts low, out-of-stock and active items (inactive ignored)", async () => {
    await item(5, 10); // low
    await item(0, 0); // out of stock, no minimum: not "low"
    await item(50, 10); // fine
    await item(0, 10, { active: false }); // inactive: ignored
    const res = await http()
      .get("/v1/shop/inventory/summary")
      .query({ shopId: fx.shop.id })
      .set(as(fx.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      shopId: fx.shop.id,
      trackingEnabled: false,
      activeItems: 3,
      lowStockCount: 1,
      outOfStockCount: 1,
      openAlertCount: 0,
    });
    expect(res.body.lowStockItems).toHaveLength(1);
    expect(res.body.lowStockItems[0]).toMatchObject({
      quantity: 5,
      minQuantity: 10,
      lowStock: true,
    });
  });

  it("alerts list shows OPEN alerts with item name and current stock, paginated; RESOLVED via the status filter", async () => {
    await fx.prisma.shop.update({
      where: { id: fx.shop.id },
      data: { inventoryTrackingEnabled: true },
    });
    const low = await item(2, 10, { name: "A4 alert item" });
    // the same sweep the worker runs (its own e2e proves the worker wiring)
    await syncLowStockAlerts(fx.prisma);
    const open = await http()
      .get("/v1/shop/inventory/alerts")
      .query({ shopId: fx.shop.id })
      .set(as(fx.operator.token));
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ limit: 50, offset: 0 });
    const mine = open.body.items.find(
      (a: { inventoryItemId: string }) => a.inventoryItemId === low.id,
    );
    expect(mine).toMatchObject({
      status: "OPEN",
      itemName: "A4 alert item",
      quantityAtAlert: 2,
      minQuantity: 10,
      currentQuantity: 2,
    });
    const summary = await http()
      .get("/v1/shop/inventory/summary")
      .query({ shopId: fx.shop.id })
      .set(as(fx.token));
    expect(summary.body.openAlertCount).toBeGreaterThanOrEqual(1);

    await fx.prisma.inventoryItem.update({ where: { id: low.id }, data: { quantity: 500 } });
    await syncLowStockAlerts(fx.prisma);
    const resolved = await http()
      .get("/v1/shop/inventory/alerts")
      .query({ shopId: fx.shop.id, status: "RESOLVED", limit: 1 })
      .set(as(fx.token));
    expect(resolved.body.items).toHaveLength(1);
    expect(resolved.body.limit).toBe(1);
    expect(resolved.body.items[0].status).toBe("RESOLVED");
    const stillOpen = await http()
      .get("/v1/shop/inventory/alerts")
      .query({ shopId: fx.shop.id })
      .set(as(fx.token));
    expect(
      stillOpen.body.items.some((a: { inventoryItemId: string }) => a.inventoryItemId === low.id),
    ).toBe(false);
  });

  it("permissions and isolation: counter 403, other shop 403, anonymous 401, bad status 400", async () => {
    for (const path of ["summary", "alerts"]) {
      const q = { shopId: fx.shop.id };
      const get = (token?: string) => {
        const r = http().get(`/v1/shop/inventory/${path}`).query(q);
        return token ? r.set(as(token)) : r;
      };
      expect((await get(fx.counter.token)).status).toBe(403);
      expect((await get(fx.ownerB.token)).status).toBe(403);
      expect((await get()).status).toBe(401);
    }
    expect(
      (
        await http()
          .get("/v1/shop/inventory/alerts")
          .query({ shopId: fx.shop.id, status: "NOPE" })
          .set(as(fx.token))
      ).status,
    ).toBe(400);
  });
});
