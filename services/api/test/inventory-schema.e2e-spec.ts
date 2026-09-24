import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/** 20.1 (§26/§27): the inventory tables and their DB-level guarantees, checked
 * against the real database with raw SQL (the DDL outcome, not what
 * schema.prisma claims). The guarantees matter because 20.2/20.4/20.7 lean on
 * them as the last line of defence for "never a negative stock" and "one
 * movement per idempotency key". */
describe("Inventory schema (20.1, e2e)", () => {
  const prisma = new PrismaClient();
  const shopId = randomUUID();
  const itemId = randomUUID();
  const item2Id = randomUUID();
  const movementIds: string[] = [];

  beforeAll(async () => {
    await prisma.$executeRaw`
      INSERT INTO shops (id, name, address, status, updated_at)
      VALUES (${shopId}, ${`inventory-schema ${shopId}`}, '1', 'OPEN', now())`;
  });
  afterAll(async () => {
    // Targeted: only this suite's own rows (movements cascade with items, items with the shop).
    await prisma.$executeRaw`DELETE FROM shops WHERE id = ${shopId}`;
    await prisma.$disconnect();
  });

  async function insertItem(
    id: string,
    extra: { sku?: string; quantity?: number; min?: number; max?: number | null } = {},
  ) {
    await prisma.$executeRaw`
      INSERT INTO inventory_items (id, shop_id, name, sku, paper_size, quantity, min_quantity, max_quantity, updated_at)
      VALUES (${id}, ${shopId}, 'A4 80gsm', ${extra.sku ?? null}, 'A4', ${extra.quantity ?? 10},
              ${extra.min ?? 0}, ${extra.max ?? null}, now())`;
  }

  it("creates both tables with the PRD 26/27 columns", async () => {
    const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('inventory_items', 'inventory_movements')`;
    const byTable = (t: string) => cols.filter((c) => c.table_name === t).map((c) => c.column_name);
    expect(byTable("inventory_items")).toEqual(
      expect.arrayContaining([
        "name",
        "sku",
        "paper_size",
        "paper_type",
        "weight_gsm",
        "quantity",
        "min_quantity",
        "max_quantity",
        "location",
        "unit_cost_minor",
        "updated_at",
      ]),
    );
    expect(byTable("inventory_movements")).toEqual(
      expect.arrayContaining([
        "inventory_item_id",
        "type",
        "quantity_delta",
        "quantity_after",
        "reason",
        "actor_id",
        "print_job_id",
        "idempotency_key",
      ]),
    );
  });

  it("refuses negative stock, negative minimum and max below min at the database", async () => {
    await expect(insertItem(randomUUID(), { quantity: -1 })).rejects.toThrow(
      /inventory_items_quantity_non_negative/,
    );
    await expect(insertItem(randomUUID(), { min: -1 })).rejects.toThrow(
      /inventory_items_min_quantity_non_negative/,
    );
    await expect(insertItem(randomUUID(), { min: 10, max: 5 })).rejects.toThrow(
      /inventory_items_max_gte_min/,
    );
  });

  it("makes a SKU unique per shop but allows many items without one", async () => {
    await insertItem(itemId, { sku: "A4-80" });
    await expect(insertItem(randomUUID(), { sku: "A4-80" })).rejects.toThrow(
      /Key .shop_id, sku.*already exists/s,
    );
    await insertItem(item2Id);
    const extra = randomUUID();
    await insertItem(extra);
    // two SKU-less items coexist (NULLs are distinct)
    expect(
      await prisma.$queryRaw<
        unknown[]
      >`SELECT 1 FROM inventory_items WHERE shop_id = ${shopId} AND sku IS NULL`,
    ).toHaveLength(2);
  });

  async function insertMovement(
    over: { delta?: number; after?: number; key?: string | null; type?: string } = {},
  ) {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO inventory_movements (id, shop_id, inventory_item_id, type, quantity_delta, quantity_after, idempotency_key)
      VALUES (${id}, ${shopId}, ${itemId}, ${over.type ?? "ADJUSTMENT"}::"InventoryMovementType", ${over.delta ?? 5}, ${over.after ?? 15}, ${over.key ?? null})`;
    movementIds.push(id);
    return id;
  }

  it("has exactly the six PRD 27 movement types", async () => {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'InventoryMovementType'`;
    expect(rows.map((r) => r.enumlabel).sort()).toEqual([
      "ADJUSTMENT",
      "CONSUMPTION",
      "CORRECTION",
      "PURCHASE",
      "RETURN",
      "TRANSFER",
    ]);
  });

  it("refuses a zero-delta movement and a negative resulting quantity", async () => {
    await expect(insertMovement({ delta: 0 })).rejects.toThrow(
      /inventory_movements_delta_non_zero/,
    );
    await expect(insertMovement({ after: -1 })).rejects.toThrow(
      /inventory_movements_after_non_negative/,
    );
  });

  it("makes the idempotency key unique (a replayed movement cannot be recorded twice)", async () => {
    await insertMovement({ key: "consumption:job-1" });
    await expect(insertMovement({ key: "consumption:job-1" })).rejects.toThrow(
      /Key .idempotency_key.*already exists/s,
    );
    // keyless movements never collide
    await insertMovement();
    await insertMovement();
  });

  it("is append-only: a movement row cannot be UPDATEd", async () => {
    const id = await insertMovement();
    await expect(
      prisma.$executeRaw`UPDATE inventory_movements SET quantity_delta = 99 WHERE id = ${id}`,
    ).rejects.toThrow(/append-only/);
  });
});
