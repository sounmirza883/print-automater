import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/** Step 3 (branch-scoped operations), B1: orders, print jobs, printers, agents and pairing codes
 * belong to a branch, and the shared dev database keeps working for code that does not know about
 * branches. Checked against the real database with raw SQL (the DDL outcome, not what
 * schema.prisma claims), and with raw INSERTs that leave `branch_id` out, which is exactly what
 * an older running copy of the API sends. */
describe("Branch operations schema (step 3 / B1, e2e)", () => {
  const prisma = new PrismaClient();
  const shopId = randomUUID();
  const otherShopId = randomUUID();
  const userId = randomUUID();
  const documentId = randomUUID();
  let branchA = "";
  let branchB = "";
  let otherShopBranch = "";

  async function insertShop(id: string): Promise<string> {
    await prisma.$executeRaw`
      INSERT INTO shops (id, name, address, status, updated_at)
      VALUES (${id}, ${`branch-ops-schema ${id}`}, '1', 'OPEN', now())`;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM branches WHERE shop_id = ${id} ORDER BY created_at, id LIMIT 1`;
    return rows[0]!.id;
  }

  beforeAll(async () => {
    // The first-branch trigger gives every shop its branch.
    branchA = await insertShop(shopId);
    otherShopBranch = await insertShop(otherShopId);
    branchB = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO branches (id, shop_id, name, address, created_at, updated_at)
      VALUES (${branchB}, ${shopId}, 'Second', '2', now() + interval '1 second', now())`;
    await prisma.$executeRaw`
      INSERT INTO users (id, role, name, email, password_hash, updated_at)
      VALUES (${userId}, 'CUSTOMER', 'schema', ${`schema-${userId}@print-automated.dev`}, 'x', now())`;
    await prisma.$executeRaw`
      INSERT INTO documents (id, owner_user_id, storage_key, filename, mime_type, size_bytes, status, updated_at)
      VALUES (${documentId}, ${userId}, ${`test/${documentId}`}, 'a.pdf', 'application/pdf', 1, 'READY', now())`;
  });

  afterAll(async () => {
    // Targeted: only this suite's rows, children first.
    await prisma.$executeRaw`DELETE FROM print_jobs WHERE shop_id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM orders WHERE shop_id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM printers WHERE shop_id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM printer_agents WHERE shop_id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM agent_pairing_codes WHERE shop_id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM staff_notifications WHERE shop_id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM shops WHERE id IN (${shopId}, ${otherShopId})`;
    await prisma.$executeRaw`DELETE FROM documents WHERE id = ${documentId}`;
    await prisma.$executeRaw`DELETE FROM users WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  const branchOf = async (table: string, id: string): Promise<string | null> => {
    const rows = await prisma.$queryRawUnsafe<Array<{ branch_id: string | null }>>(
      `SELECT branch_id FROM ${table} WHERE id = $1`,
      id,
    );
    return rows[0]?.branch_id ?? null;
  };

  /** One INSERT per table, with or without an explicit branch. `undefined` leaves the column out
   * entirely (what older code does); the schema is NOT NULL, so a trigger must fill it. */
  async function insertPrinter(branch?: string, forShop = shopId): Promise<string> {
    const id = randomUUID();
    if (branch === undefined) {
      await prisma.$executeRaw`
        INSERT INTO printers (id, shop_id, name, updated_at) VALUES (${id}, ${forShop}, 'P', now())`;
    } else {
      await prisma.$executeRaw`
        INSERT INTO printers (id, shop_id, branch_id, name, updated_at)
        VALUES (${id}, ${forShop}, ${branch}, 'P', now())`;
    }
    return id;
  }
  async function insertAgent(branch?: string): Promise<string> {
    const id = randomUUID();
    if (branch === undefined) {
      await prisma.$executeRaw`
        INSERT INTO printer_agents (id, device_id, shop_id, public_key)
        VALUES (${id}, ${randomUUID()}, ${shopId}, 'k')`;
    } else {
      await prisma.$executeRaw`
        INSERT INTO printer_agents (id, device_id, shop_id, branch_id, public_key)
        VALUES (${id}, ${randomUUID()}, ${shopId}, ${branch}, 'k')`;
    }
    return id;
  }
  async function insertCode(branch?: string): Promise<string> {
    const id = randomUUID();
    if (branch === undefined) {
      await prisma.$executeRaw`
        INSERT INTO agent_pairing_codes (id, code_hash, shop_id, created_by, expires_at)
        VALUES (${id}, ${randomUUID()}, ${shopId}, ${userId}, now() + interval '10 minutes')`;
    } else {
      await prisma.$executeRaw`
        INSERT INTO agent_pairing_codes (id, code_hash, shop_id, branch_id, created_by, expires_at)
        VALUES (${id}, ${randomUUID()}, ${shopId}, ${branch}, ${userId}, now() + interval '10 minutes')`;
    }
    return id;
  }
  async function insertOrder(branch?: string): Promise<string> {
    const id = randomUUID();
    if (branch === undefined) {
      await prisma.$executeRaw`
        INSERT INTO orders (id, public_order_number, customer_id, shop_id, document_id,
                            print_configuration, pricing_snapshot, updated_at)
        VALUES (${id}, ${`T-${id}`}, ${userId}, ${shopId}, ${documentId}, '{}'::jsonb, '{}'::jsonb, now())`;
    } else {
      await prisma.$executeRaw`
        INSERT INTO orders (id, public_order_number, customer_id, shop_id, branch_id, document_id,
                            print_configuration, pricing_snapshot, updated_at)
        VALUES (${id}, ${`T-${id}`}, ${userId}, ${shopId}, ${branch}, ${documentId}, '{}'::jsonb, '{}'::jsonb, now())`;
    }
    return id;
  }
  async function insertJob(orderId: string, branch?: string): Promise<string> {
    const id = randomUUID();
    if (branch === undefined) {
      await prisma.$executeRaw`
        INSERT INTO print_jobs (id, order_id, shop_id, idempotency_token, updated_at)
        VALUES (${id}, ${orderId}, ${shopId}, ${randomUUID()}, now())`;
    } else {
      await prisma.$executeRaw`
        INSERT INTO print_jobs (id, order_id, shop_id, branch_id, idempotency_token, updated_at)
        VALUES (${id}, ${orderId}, ${shopId}, ${branch}, ${randomUUID()}, now())`;
    }
    return id;
  }

  it("adds branch_id NOT NULL to the five operational tables and a nullable one to alerts", async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; is_nullable: string }>>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE column_name = 'branch_id'
        AND table_name IN ('orders', 'print_jobs', 'printers', 'printer_agents',
                           'agent_pairing_codes', 'staff_notifications')`;
    const nullable = Object.fromEntries(rows.map((r) => [r.table_name, r.is_nullable]));
    expect(nullable).toEqual({
      orders: "NO",
      print_jobs: "NO",
      printers: "NO",
      printer_agents: "NO",
      agent_pairing_codes: "NO",
      staff_notifications: "YES",
    });
  });

  it("backfilled every existing row into its business's branch (nothing is orphaned)", async () => {
    // A row whose branch is missing or belongs to another business would break the NOT NULL +
    // composite FK, so a clean count here proves the backfill and the constraints agree.
    const mismatched = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT (
        (SELECT count(*) FROM orders o LEFT JOIN branches b ON b.id = o.branch_id AND b.shop_id = o.shop_id WHERE b.id IS NULL)
        + (SELECT count(*) FROM print_jobs o LEFT JOIN branches b ON b.id = o.branch_id AND b.shop_id = o.shop_id WHERE b.id IS NULL)
        + (SELECT count(*) FROM printers o LEFT JOIN branches b ON b.id = o.branch_id AND b.shop_id = o.shop_id WHERE b.id IS NULL)
        + (SELECT count(*) FROM printer_agents o LEFT JOIN branches b ON b.id = o.branch_id AND b.shop_id = o.shop_id WHERE b.id IS NULL)
        + (SELECT count(*) FROM agent_pairing_codes o LEFT JOIN branches b ON b.id = o.branch_id AND b.shop_id = o.shop_id WHERE b.id IS NULL)
      )::int AS count`;
    expect(mismatched[0]!.count).toBe(0);
  });

  describe("older code that leaves branch_id out keeps inserting (BEFORE INSERT triggers)", () => {
    it("fills the business's oldest non-archived branch on every table", async () => {
      const printer = await insertPrinter();
      const agent = await insertAgent();
      const code = await insertCode();
      const order = await insertOrder();
      expect(await branchOf("printers", printer)).toBe(branchA);
      expect(await branchOf("printer_agents", agent)).toBe(branchA);
      expect(await branchOf("agent_pairing_codes", code)).toBe(branchA);
      expect(await branchOf("orders", order)).toBe(branchA);
    });

    it("gives a print job its order's branch, not the business's first", async () => {
      const order = await insertOrder(branchB);
      const job = await insertJob(order);
      expect(await branchOf("print_jobs", job)).toBe(branchB);
    });

    it("skips an archived branch when it picks the default", async () => {
      await prisma.$executeRaw`UPDATE branches SET archived_at = now() WHERE id = ${branchA}`;
      try {
        const printer = await insertPrinter();
        expect(await branchOf("printers", printer)).toBe(branchB);
      } finally {
        await prisma.$executeRaw`UPDATE branches SET archived_at = NULL WHERE id = ${branchA}`;
      }
    });
  });

  describe("an explicit branch is always honoured", () => {
    it("stores the second branch, never the default", async () => {
      const printer = await insertPrinter(branchB);
      const agent = await insertAgent(branchB);
      const code = await insertCode(branchB);
      const order = await insertOrder(branchB);
      const job = await insertJob(order, branchB);
      expect(await branchOf("printers", printer)).toBe(branchB);
      expect(await branchOf("printer_agents", agent)).toBe(branchB);
      expect(await branchOf("agent_pairing_codes", code)).toBe(branchB);
      expect(await branchOf("orders", order)).toBe(branchB);
      expect(await branchOf("print_jobs", job)).toBe(branchB);
    });
  });

  describe("a row can only point at its own business's branch (composite foreign key)", () => {
    it("refuses another business's branch on every table", async () => {
      await expect(insertPrinter(otherShopBranch)).rejects.toThrow(/printers_branch_shop_fkey/);
      await expect(insertAgent(otherShopBranch)).rejects.toThrow(/printer_agents_branch_shop_fkey/);
      await expect(insertCode(otherShopBranch)).rejects.toThrow(
        /agent_pairing_codes_branch_shop_fkey/,
      );
      await expect(insertOrder(otherShopBranch)).rejects.toThrow(/orders_branch_shop_fkey/);
      const order = await insertOrder(branchA);
      await expect(insertJob(order, otherShopBranch)).rejects.toThrow(
        /print_jobs_branch_shop_fkey/,
      );
    });

    it("refuses a staff alert for another business's branch, and allows none (business-wide)", async () => {
      const insert = (branch: string | null) => prisma.$executeRaw`
        INSERT INTO staff_notifications (id, user_id, shop_id, branch_id, type, title, body, target_type, target_id)
        VALUES (${randomUUID()}, ${userId}, ${shopId}, ${branch}, 'LOW_STOCK', 't', 'b', 'ORDER', 'x')`;
      await expect(insert(otherShopBranch)).rejects.toThrow(/staff_notifications_branch_shop_fkey/);
      await expect(insert(null)).resolves.toBe(1);
      await expect(insert(branchB)).resolves.toBe(1);
    });
  });

  it("has the list indexes the filtered queries need", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('orders', 'print_jobs', 'printers', 'printer_agents', 'agent_pairing_codes')
        AND indexdef LIKE '%branch_id%'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "orders_shop_id_branch_id_order_status_idx",
        "orders_shop_id_branch_id_created_at_idx",
        "print_jobs_shop_id_branch_id_status_idx",
        "printers_shop_id_branch_id_idx",
        "printer_agents_shop_id_branch_id_idx",
        "agent_pairing_codes_shop_id_branch_id_idx",
      ]),
    );
  });
});
