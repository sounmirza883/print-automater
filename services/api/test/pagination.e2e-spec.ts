import { randomUUID } from "node:crypto";
import { OrderStatus, PaymentStatus, PrinterStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 23.6: every list endpoint is bounded. Legacy callers (no limit/offset) still get the
 * bare array they always got, now capped; `?limit=&offset=` opts into
 * `{items,total,limit,offset}` (limit 1-100, default 50). */
describe("Pagination on every list endpoint (23.6, e2e)", () => {
  let fx: InventoryFixture;
  let adminToken: string;
  let adminId: string;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (path: string, query: Record<string, string | number> = {}, token = fx.token) =>
    http().get(path).query(query).set(as(token));

  beforeAll(async () => {
    fx = await createInventoryFixture("pag", { multiItemEnabled: false });
    const admin = await fx.prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "pag admin",
        email: `pag-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    adminId = admin.id;
    adminToken = fx.tokens.issueAccessToken(admin);
  });
  afterAll(async () => {
    if (fx) {
      await fx.prisma.pricingRule.deleteMany({ where: { shopId: fx.shop.id } });
      await fx.cleanup();
      await fx.prisma.user.deleteMany({ where: { id: adminId } });
    }
  });

  function expectEnvelope(
    body: unknown,
    expected: { total: number; limit: number; offset: number },
  ) {
    expect(body).toMatchObject(expected);
    expect(Array.isArray((body as { items: unknown[] }).items)).toBe(true);
  }

  describe("customers", () => {
    beforeAll(async () => {
      await fx.prisma.customer.createMany({
        data: ["Ann", "Bob", "Cyd"].map((name) => ({
          shopId: fx.shop.id,
          name: `${name} Customer`,
          phone: `0300${name.length}`,
          email: `${name.toLowerCase()}@example.test`,
        })),
      });
      await fx.prisma.customer.create({ data: { shopId: fx.shopB.id, name: "Ann Other Shop" } });
    });

    it("legacy call returns the bare array; a page returns the envelope with this shop's total only", async () => {
      const legacy = await get("/v1/shop/customers", { shopId: fx.shop.id });
      expect(legacy.status).toBe(200);
      expect(Array.isArray(legacy.body)).toBe(true);
      expect(legacy.body).toHaveLength(3);
      const page = await get("/v1/shop/customers", { shopId: fx.shop.id, limit: 2 });
      expectEnvelope(page.body, { total: 3, limit: 2, offset: 0 });
      expect(page.body.items).toHaveLength(2);
      const second = await get("/v1/shop/customers", { shopId: fx.shop.id, limit: 2, offset: 2 });
      expect(second.body.items).toHaveLength(1);
      const onlyOffset = await get("/v1/shop/customers", { shopId: fx.shop.id, offset: 1 });
      expectEnvelope(onlyOffset.body, { total: 3, limit: 50, offset: 1 });
    });

    it("q filters (name, phone or email) inside the page and never crosses shops", async () => {
      const res = await get("/v1/shop/customers", { shopId: fx.shop.id, q: "ann", limit: 10 });
      expectEnvelope(res.body, { total: 1, limit: 10, offset: 0 });
      expect(res.body.items[0].name).toBe("Ann Customer");
      const byEmail = await get("/v1/shop/customers", {
        shopId: fx.shop.id,
        q: "bob@example",
        limit: 10,
      });
      expect(byEmail.body.total).toBe(1);
      const wildcard = await get("/v1/shop/customers", { shopId: fx.shop.id, q: "%", limit: 10 });
      expect(wildcard.body.total).toBe(0); // a literal percent, not "match everything"
    });

    it("limit outside 1..100 and a negative offset are 400", async () => {
      const bad: Array<Record<string, string | number>> = [
        { limit: 0 },
        { limit: 101 },
        { offset: -1 },
        { limit: "abc" },
      ];
      for (const query of bad) {
        expect((await get("/v1/shop/customers", { shopId: fx.shop.id, ...query })).status).toBe(
          400,
        );
      }
    });

    it("an unpaged call is BOUNDED (500) even with more rows than that", async () => {
      await fx.prisma.customer.createMany({
        data: Array.from({ length: 510 }, (_, i) => ({
          shopId: fx.shop.id,
          name: `Bulk ${String(i).padStart(3, "0")}`,
        })),
      });
      const legacy = await get("/v1/shop/customers", { shopId: fx.shop.id });
      expect(legacy.body).toHaveLength(500);
      const page = await get("/v1/shop/customers", { shopId: fx.shop.id, limit: 1 });
      expect(page.body.total).toBe(513);
    });

    it("another business cannot page this shop's customers", async () => {
      expect(
        (await get("/v1/shop/customers", { shopId: fx.shop.id, limit: 5 }, fx.ownerB.token)).status,
      ).toBe(403);
    });
  });

  describe("printers", () => {
    beforeAll(async () => {
      await fx.makePrinter("pag-alpha", { status: PrinterStatus.ONLINE });
      await fx.makePrinter("pag-beta", { status: PrinterStatus.OFFLINE });
      await fx.makePrinter("pag-gamma", { status: PrinterStatus.ONLINE });
    });

    it("legacy array, envelope, q and status filters", async () => {
      const legacy = await get("/v1/shop/printers", { shopId: fx.shop.id });
      expect(Array.isArray(legacy.body)).toBe(true);
      expect(legacy.body).toHaveLength(3);
      expect(legacy.body[0]).toHaveProperty("pagesUsedInPeriod");
      const page = await get("/v1/shop/printers", { shopId: fx.shop.id, limit: 2 });
      expectEnvelope(page.body, { total: 3, limit: 2, offset: 0 });
      expect(page.body.items[0]).toHaveProperty("remainingAllowance");
      const q = await get("/v1/shop/printers", { shopId: fx.shop.id, q: "BETA", limit: 5 });
      expect(q.body.items.map((p: { name: string }) => p.name)).toEqual(["pag-beta"]);
      const status = await get("/v1/shop/printers", {
        shopId: fx.shop.id,
        status: "ONLINE",
        limit: 5,
      });
      expect(status.body.total).toBe(2);
      expect((await get("/v1/shop/printers", { shopId: fx.shop.id, status: "NOPE" })).status).toBe(
        400,
      );
    });

    it("another business sees 403; its own list is empty", async () => {
      expect(
        (await get("/v1/shop/printers", { shopId: fx.shop.id, limit: 5 }, fx.ownerB.token)).status,
      ).toBe(403);
      const own = await get(
        "/v1/shop/printers",
        { shopId: fx.shopB.id, limit: 5 },
        fx.ownerB.token,
      );
      expectEnvelope(own.body, { total: 0, limit: 5, offset: 0 });
    });
  });

  describe("products", () => {
    beforeAll(async () => {
      await fx.prisma.product.createMany({
        data: [
          { shopId: fx.shop.id, name: "Business Cards", category: "Marketing" },
          { shopId: fx.shop.id, name: "Handout Booklet", category: "Stationery" },
          { shopId: fx.shop.id, name: "Old Flyer", category: "Marketing", available: false },
        ],
      });
    });
    it("legacy array, envelope, q, category and availability filters", async () => {
      expect((await get("/v1/shop/products", { shopId: fx.shop.id })).body).toHaveLength(3);
      const page = await get("/v1/shop/products", { shopId: fx.shop.id, limit: 2 });
      expectEnvelope(page.body, { total: 3, limit: 2, offset: 0 });
      const q = await get("/v1/shop/products", { shopId: fx.shop.id, q: "booklet", limit: 5 });
      expect(q.body.total).toBe(1);
      const cat = await get("/v1/shop/products", {
        shopId: fx.shop.id,
        category: "Marketing",
        limit: 5,
      });
      expect(cat.body.total).toBe(2);
      const avail = await get("/v1/shop/products", {
        shopId: fx.shop.id,
        available: "true",
        limit: 5,
      });
      expect(avail.body.total).toBe(2);
    });
    it("needs MANAGE_PRICES; other business 403", async () => {
      expect(
        (await get("/v1/shop/products", { shopId: fx.shop.id, limit: 5 }, fx.counter.token)).status,
      ).toBe(403);
      expect(
        (await get("/v1/shop/products", { shopId: fx.shop.id, limit: 5 }, fx.ownerB.token)).status,
      ).toBe(403);
    });
  });

  describe("pricing rules", () => {
    it("legacy array and envelope over the versions", async () => {
      for (const version of [1, 2, 3]) {
        await fx.prisma.pricingRule.create({
          data: {
            shopId: fx.shop.id,
            version,
            currency: "PKR",
            pricePerPageMinor: 10,
            colorSurchargePerPageMinor: 5,
            otherCharges: {},
            minimumChargeMinor: 0,
          },
        });
      }
      const legacy = await get("/v1/shop/pricing-rules", { shopId: fx.shop.id });
      expect(legacy.body.map((r: { version: number }) => r.version)).toEqual([3, 2, 1]);
      const page = await get("/v1/shop/pricing-rules", { shopId: fx.shop.id, limit: 2, offset: 1 });
      expectEnvelope(page.body, { total: 3, limit: 2, offset: 1 });
      expect(page.body.items.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    });
  });

  describe("customer orders (GET /v1/orders)", () => {
    it("legacy array, envelope and status filter, own orders only", async () => {
      await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP);
      await fx.makeOrder(1, 1, OrderStatus.COMPLETED);
      await fx.makeOrder(1, 1, OrderStatus.COMPLETED);
      const token = fx.tokens.issueAccessToken(fx.customer);
      const legacy = await get("/v1/orders", {}, token);
      expect(Array.isArray(legacy.body)).toBe(true);
      expect(legacy.body).toHaveLength(3);
      const page = await get("/v1/orders", { limit: 2 }, token);
      expectEnvelope(page.body, { total: 3, limit: 2, offset: 0 });
      const completed = await get("/v1/orders", { status: "COMPLETED", limit: 10 }, token);
      expect(completed.body.total).toBe(2);
      // someone else's token sees none of them
      const other = await get("/v1/orders", { limit: 10 }, fx.ownerB.token);
      expect(other.body.total).toBe(0);
    });
  });

  describe("shop orders (GET /v1/shop/orders)", () => {
    beforeAll(async () => {
      const doc = await fx.prisma.document.findFirstOrThrow({
        where: { ownerUserId: fx.customer.id },
      });
      await fx.prisma.order.createMany({
        data: Array.from({ length: 205 }, (_, i) => ({
          publicOrderNumber: `TEST-pagorders-${randomUUID()}-${i}`,
          customerId: fx.customer.id,
          shopId: fx.shop.id,
          documentId: doc.id,
          printConfiguration: {},
          pricingSnapshot: {},
          orderStatus: OrderStatus.COMPLETED,
          paymentStatus: PaymentStatus.PAID,
          createdAt: new Date(Date.now() - i * 1000),
        })),
      });
      await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP);
    });

    it("the legacy grouped shape is kept but every group is bounded (completed: newest 200)", async () => {
      const res = await get("/v1/shop/orders", { shopId: fx.shop.id });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        "completed",
        "failed",
        "needsAttention",
        "printing",
        "ready",
      ]);
      expect(res.body.completed).toHaveLength(200);
      // the live queue is never trimmed
      expect(res.body.needsAttention.length).toBeGreaterThanOrEqual(1);
    });

    it("group + limit/offset pages one group as a flat envelope, newest first", async () => {
      const page = await get("/v1/shop/orders", {
        shopId: fx.shop.id,
        group: "completed",
        limit: 100,
        offset: 200,
      });
      expect(page.status).toBe(200);
      expectEnvelope(page.body, { total: 205 + 2, limit: 100, offset: 200 });
      expect(page.body.items).toHaveLength(7);
      const first = await get("/v1/shop/orders", {
        shopId: fx.shop.id,
        group: "completed",
        limit: 3,
      });
      const dates = first.body.items.map((o: { createdAt: string }) => Date.parse(o.createdAt));
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
      expect(
        (await get("/v1/shop/orders", { shopId: fx.shop.id, group: "nope", limit: 3 })).status,
      ).toBe(400);
    });

    it("limit/offset without group pages the visible orders of all groups", async () => {
      const page = await get("/v1/shop/orders", { shopId: fx.shop.id, limit: 5 });
      expect(page.status).toBe(200);
      expect(page.body.items).toHaveLength(5);
      expect(page.body.total).toBeGreaterThanOrEqual(206);
    });
  });

  describe("shop staff (GET /v1/shop/staff)", () => {
    it("owner and manager list this shop's staff, paged, with role and name", async () => {
      for (const token of [fx.token, fx.manager.token]) {
        const res = await get("/v1/shop/staff", { shopId: fx.shop.id }, token);
        expect(res.status).toBe(200);
        expectEnvelope(res.body, { total: 4, limit: 50, offset: 0 });
        expect(res.body.items[0]).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            userId: expect.any(String),
            name: expect.any(String),
            email: expect.any(String),
            role: expect.any(String),
            status: "ACTIVE",
          }),
        );
        expect(JSON.stringify(res.body)).not.toContain("passwordHash");
      }
      const operators = await get("/v1/shop/staff", { shopId: fx.shop.id, role: "OPERATOR" });
      expect(operators.body.total).toBe(1);
      const paged = await get("/v1/shop/staff", { shopId: fx.shop.id, limit: 1, offset: 3 });
      expect(paged.body.items).toHaveLength(1);
    });
    it("counter/operator (no MANAGE_USERS) and other businesses are refused", async () => {
      for (const token of [fx.counter.token, fx.operator.token, fx.ownerB.token]) {
        expect((await get("/v1/shop/staff", { shopId: fx.shop.id }, token)).status).toBe(403);
      }
      expect((await http().get("/v1/shop/staff").query({ shopId: fx.shop.id })).status).toBe(401);
      const own = await get("/v1/shop/staff", { shopId: fx.shopB.id }, fx.ownerB.token);
      expect(own.body.total).toBe(1);
    });
  });

  describe("public shop discovery (GET /v1/shops)", () => {
    it("legacy array unchanged; a page returns the envelope; capability filters still apply", async () => {
      await fx.prisma.shop.update({
        where: { id: fx.shop.id },
        data: { capabilities: { color: true, duplex: false, a4: true, a3: false } },
      });
      const legacy = await http().get("/v1/shops");
      expect(legacy.status).toBe(200);
      expect(Array.isArray(legacy.body)).toBe(true);
      const page = await http().get("/v1/shops").query({ limit: 1 });
      expect(page.body.items).toHaveLength(1);
      expect(page.body.limit).toBe(1);
      expect(page.body.total).toBeGreaterThanOrEqual(1);
      const duplex = await http().get("/v1/shops").query({ duplex: "true", limit: 100 });
      expect(duplex.body.items.map((s: { id: string }) => s.id)).not.toContain(fx.shop.id);
      const color = await http().get("/v1/shops").query({ color: "true", limit: 100 });
      expect(color.body.items.map((s: { id: string }) => s.id)).toContain(fx.shop.id);
      const legacyDuplex = await http().get("/v1/shops").query({ duplex: "true" });
      expect(legacyDuplex.body.map((s: { id: string }) => s.id)).not.toContain(fx.shop.id);
    });
  });

  describe("admin lists", () => {
    it("accept limit/offset (and the older take/skip) and always echo limit and offset", async () => {
      for (const path of ["businesses", "users", "audit"]) {
        const a = await get(`/v1/admin/${path}`, { limit: 2, offset: 0 }, adminToken);
        expect(a.status).toBe(200);
        expect(a.body).toMatchObject({ limit: 2, offset: 0 });
        expect(a.body.items.length).toBeLessThanOrEqual(2);
        const b = await get(`/v1/admin/${path}`, { take: 3, skip: 1 }, adminToken);
        expect(b.status).toBe(200);
        expect(b.body).toMatchObject({ limit: 3, offset: 1 });
        expect(typeof b.body.total).toBe("number");
        expect((await get(`/v1/admin/${path}`, { limit: 201 }, adminToken)).status).toBe(400);
      }
    });
  });
});
