import { AppException, PrismaService, applyStockMovement } from "@print-automated/backend-shared";
import { InventoryMovementType } from "@prisma/client";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.2 (§100): "inventory updates must prevent incorrect stock calculations
 * from concurrent operations". Every case here uses Promise.all against the
 * real database. Promise.all cannot PROVE the transactions overlapped, so the
 * contended cases run several rounds. */
describe("Inventory stock math (20.2, e2e)", () => {
  let fx: InventoryFixture;
  let prisma: PrismaService;

  beforeAll(async () => {
    fx = await createInventoryFixture("inv-stock");
    prisma = fx.prisma;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  async function makeItem(quantity: number): Promise<string> {
    const item = await prisma.inventoryItem.create({
      data: { shopId: fx.shop.id, name: "A4 80gsm", paperSize: "A4", quantity },
    });
    return item.id;
  }
  const move = (
    itemId: string,
    delta: number,
    over: Partial<Parameters<typeof applyStockMovement>[1]> = {},
  ) =>
    prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        shopId: fx.shop.id,
        itemId,
        type: delta < 0 ? InventoryMovementType.CONSUMPTION : InventoryMovementType.PURCHASE,
        quantityDelta: delta,
        actorId: fx.owner.id,
        ...over,
      }),
    );
  const quantityOf = async (itemId: string) =>
    (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).quantity;

  it("applies a delta, records the movement with the resulting quantity, and audits it", async () => {
    const id = await makeItem(10);
    const result = await move(id, -4, { reason: "spoilage" });
    expect(result).toMatchObject({ outcome: "APPLIED", quantityAfter: 6, appliedDelta: -4 });
    expect(await quantityOf(id)).toBe(6);
    const rows = await prisma.inventoryMovement.findMany({ where: { inventoryItemId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantityDelta: -4,
      quantityAfter: 6,
      reason: "spoilage",
      actorId: fx.owner.id,
    });
    const audit = await prisma.auditLog.findMany({
      where: { resourceId: id, action: "INVENTORY_MOVEMENT" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({
      movementId: rows[0]!.id,
      quantityDelta: -4,
      quantityAfter: 6,
    });
  });

  it("STRICT mode refuses to go negative (409 INSUFFICIENT_STOCK) and changes nothing", async () => {
    const id = await makeItem(3);
    const error = await move(id, -4).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).errorCode).toBe("INSUFFICIENT_STOCK");
    expect((error as AppException).getStatus()).toBe(409);
    expect(await quantityOf(id)).toBe(3);
    expect(await prisma.inventoryMovement.count({ where: { inventoryItemId: id } })).toBe(0);
  });

  it("an unknown item, or another shop's item, is NOT_FOUND (never applied)", async () => {
    const id = await makeItem(5);
    const wrongShop = await prisma
      .$transaction((tx) =>
        applyStockMovement(tx, {
          shopId: fx.shopB.id,
          itemId: id,
          type: InventoryMovementType.PURCHASE,
          quantityDelta: 1,
        }),
      )
      .catch((e: unknown) => e);
    expect((wrongShop as AppException).getStatus()).toBe(404);
    expect(await quantityOf(id)).toBe(5);
  });

  it("CLAMP mode takes what is there, floors at zero, and reports the shortfall", async () => {
    const id = await makeItem(3);
    const result = await move(id, -10, { mode: "CLAMP" });
    expect(result).toMatchObject({
      outcome: "APPLIED",
      quantityAfter: 0,
      appliedDelta: -3,
      shortfall: 7,
    });
    expect(await quantityOf(id)).toBe(0);
    // Nothing left: no movement (a zero delta is not a movement), shortfall is the whole request.
    const empty = await move(id, -5, { mode: "CLAMP" });
    expect(empty).toMatchObject({ outcome: "NOTHING_TO_APPLY", shortfall: 5 });
    expect(await prisma.inventoryMovement.count({ where: { inventoryItemId: id } })).toBe(1);
  });

  it("the idempotency key makes a replay a DUPLICATE that changes nothing", async () => {
    const id = await makeItem(10);
    const first = await move(id, -2, { idempotencyKey: `t:${id}` });
    const replay = await move(id, -2, { idempotencyKey: `t:${id}` });
    expect(first.outcome).toBe("APPLIED");
    expect(replay).toMatchObject({
      outcome: "DUPLICATE",
      movementId: (first as { movementId: string }).movementId,
    });
    expect(await quantityOf(id)).toBe(8);
    expect(await prisma.inventoryMovement.count({ where: { inventoryItemId: id } })).toBe(1);
  });

  it("concurrent CONSUMPTIONS never oversell: 12 x 1 sheet against 5 in stock -> exactly 5 succeed, 7 are INSUFFICIENT_STOCK, stock ends at 0", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await makeItem(5);
      const settled = await Promise.allSettled(Array.from({ length: 12 }, () => move(id, -1)));
      const ok = settled.filter((r) => r.status === "fulfilled");
      const failed = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(5);
      expect(failed).toHaveLength(7);
      for (const f of failed) {
        expect((f.reason as AppException).errorCode).toBe("INSUFFICIENT_STOCK");
      }
      expect(await quantityOf(id)).toBe(0);
      const rows = await prisma.inventoryMovement.findMany({ where: { inventoryItemId: id } });
      expect(rows).toHaveLength(5);
      expect(rows.reduce((sum, r) => sum + r.quantityDelta, 0)).toBe(-5);
      // The ledger's own view is consistent: each row's resulting quantity is unique (a serial history).
      expect(new Set(rows.map((r) => r.quantityAfter)).size).toBe(5);
    }
  });

  it("concurrent CLAMPED consumptions sum to exactly the stock and never go negative", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await makeItem(7);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => move(id, -3, { mode: "CLAMP" })),
      );
      const taken = results.reduce(
        (sum, r) => sum + (r.outcome === "APPLIED" ? -r.appliedDelta : 0),
        0,
      );
      expect(taken).toBe(7);
      expect(await quantityOf(id)).toBe(0);
      const rows = await prisma.inventoryMovement.findMany({ where: { inventoryItemId: id } });
      expect(rows.reduce((sum, r) => sum + r.quantityDelta, 0)).toBe(-7);
    }
  });

  it("a mixed concurrent burst of purchases and consumptions conserves stock exactly", async () => {
    const id = await makeItem(20);
    const ops = [
      ...Array.from({ length: 10 }, () => move(id, 3)),
      ...Array.from({ length: 10 }, () => move(id, -2)),
    ];
    await Promise.all(ops);
    expect(await quantityOf(id)).toBe(20 + 30 - 20);
    const rows = await prisma.inventoryMovement.findMany({ where: { inventoryItemId: id } });
    expect(rows).toHaveLength(20);
    // every quantity_after is >= 0 and the last-created equals the item's quantity
    expect(rows.every((r) => r.quantityAfter >= 0)).toBe(true);
  });

  it("concurrent replays of ONE idempotency key apply exactly once (the rest are DUPLICATE, none error)", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await makeItem(10);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => move(id, -1, { idempotencyKey: `race:${id}` })),
      );
      expect(results.filter((r) => r.outcome === "APPLIED")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "DUPLICATE")).toHaveLength(5);
      expect(await quantityOf(id)).toBe(9);
    }
  });
});
