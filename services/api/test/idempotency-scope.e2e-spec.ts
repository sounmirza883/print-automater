import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.8: an Idempotency-Key is scoped to (route, resolved path params, caller),
 * not just the route template + body. Before, the same key and body against a
 * DIFFERENT resource replayed the first resource's cached response (a lost
 * update), and a different caller who knew the key received someone else's
 * cached response (a cross-tenant leak). */
describe("Idempotency scope (20.8, e2e)", () => {
  let fx: InventoryFixture;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    fx = await createInventoryFixture("idem-scope");
    await fx.app.listen(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const item = (shopId = fx.shop.id, quantity = 100) =>
    fx.prisma.inventoryItem.create({ data: { shopId, name: `i-${Math.random()}`, quantity } });
  const qty = async (id: string) =>
    (await fx.prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).quantity;
  const consume = (itemId: string, key: string, token = fx.token, n = 5) =>
    http()
      .post(`/v1/shop/inventory/items/${itemId}/movements`)
      .set(as(token))
      .set("Idempotency-Key", key)
      .send({ type: "CONSUMPTION", quantityDelta: -n });

  it("the same key and body against a DIFFERENT item applies to both items (no cross-resource replay)", async () => {
    const a = await item();
    const b = await item();
    const key = `scope-items-${a.id}`;
    const first = await consume(a.id, key);
    const second = await consume(b.id, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.movement.inventoryItemId).toBe(b.id);
    expect(await qty(a.id)).toBe(95);
    expect(await qty(b.id)).toBe(95);
  });

  it("a DIFFERENT user reusing the key on the same item is not served the first user's cached response", async () => {
    const a = await item();
    const key = `scope-users-${a.id}`;
    const byOwner = await consume(a.id, key, fx.token);
    const byManager = await consume(a.id, key, fx.manager.token);
    expect(byOwner.status).toBe(201);
    expect(byManager.status).toBe(201);
    expect(byManager.body.movement.id).not.toBe(byOwner.body.movement.id);
    expect(byManager.body.movement.actorId).toBe(fx.manager.user.id);
    expect(await qty(a.id)).toBe(90);
  });

  it("another shop's user replaying a known key never receives shop A's cached response", async () => {
    const a = await item(fx.shop.id);
    const bItem = await item(fx.shopB.id);
    const key = `scope-tenants-${a.id}`;
    await consume(a.id, key, fx.token);
    const other = await consume(bItem.id, key, fx.ownerB.token);
    expect(other.status).toBe(201);
    expect(other.body.movement.inventoryItemId).toBe(bItem.id);
    expect(other.body.item.shopId).toBe(fx.shopB.id);
    // and against shop A's item they are refused by the guard, never replayed
    expect((await consume(a.id, key, fx.ownerB.token)).status).toBe(403);
  });

  it("a legitimate replay (same user, same item, same key, same body) still returns the cached response and moves stock once", async () => {
    const a = await item();
    const key = `scope-replay-${a.id}`;
    const first = await consume(a.id, key);
    const replay = await consume(a.id, key);
    expect(replay.status).toBe(201);
    expect(replay.body.movement.id).toBe(first.body.movement.id);
    expect(await qty(a.id)).toBe(95);
  });

  it("the same key and item with a different body is still refused (422)", async () => {
    const a = await item();
    const key = `scope-body-${a.id}`;
    await consume(a.id, key, fx.token, 5);
    const res = await consume(a.id, key, fx.token, 6);
    expect(res.status).toBe(422);
    expect(await qty(a.id)).toBe(95);
  });

  it("concurrent requests with one key on two different items both apply", async () => {
    const a = await item();
    const b = await item();
    const key = `scope-concurrent-${a.id}`;
    const [ra, rb] = await Promise.all([consume(a.id, key), consume(b.id, key)]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(await qty(a.id)).toBe(95);
    expect(await qty(b.id)).toBe(95);
  });
});
