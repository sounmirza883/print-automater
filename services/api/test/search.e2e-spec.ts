import { randomUUID } from "node:crypto";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  PrintJobStatus,
} from "@prisma/client";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

/** 23.6 (PRD 43/44): order search and filters, plus the search-term hygiene every list
 * search shares (a literal % or _ never matches everything). */
describe("Search and filters (23.6, e2e)", () => {
  let fx: InventoryFixture;
  const tag = randomUUID().slice(0, 8);
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const search = (query: Record<string, string | number>, token = fx.token) =>
    http()
      .get("/v1/shop/orders/search")
      .query({ shopId: fx.shop.id, ...query })
      .set(as(token));
  const numbers = (res: request.Response): string[] =>
    (res.body.items as Array<{ publicOrderNumber: string }>).map((o) => o.publicOrderNumber);

  const mine = { orderIds: [] as string[], documentId: "", customerRecordId: "" };
  let walkIn: { id: string };
  let printerId: string;
  const numberOf: Record<string, string> = {};

  async function makeOrder(
    key: string,
    over: {
      status?: OrderStatus;
      payment?: PaymentStatus;
      createdAt?: Date;
      documentId?: string;
      customerRecordId?: string | null;
      shopId?: string;
    } = {},
  ) {
    const order = await fx.prisma.order.create({
      data: {
        publicOrderNumber: `PA-${tag}-${key}`,
        customerId: fx.customer.id,
        customerRecordId: over.customerRecordId ?? undefined,
        shopId: over.shopId ?? fx.shop.id,
        branchId: await branchIdOf(fx.prisma, over.shopId ?? fx.shop.id),
        documentId: over.documentId ?? mine.documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: over.status ?? OrderStatus.COMPLETED,
        paymentStatus: over.payment ?? PaymentStatus.PAID,
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      },
    });
    mine.orderIds.push(order.id);
    numberOf[key] = order.publicOrderNumber;
    return order;
  }

  beforeAll(async () => {
    fx = await createInventoryFixture("srch", { multiItemEnabled: false });
    const doc = await fx.prisma.document.create({
      data: {
        ownerUserId: fx.customer.id,
        storageKey: `test/srch/${randomUUID()}`,
        filename: `Quarterly-Ledger-${tag}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 1,
        status: DocumentStatus.READY,
      },
    });
    mine.documentId = doc.id;
    const record = await fx.prisma.customer.create({
      data: {
        shopId: fx.shop.id,
        name: `Zainab Walkin ${tag}`,
        phone: `0311${tag}`,
        email: `zainab.${tag}@example.test`,
      },
    });
    walkIn = record;
    mine.customerRecordId = record.id;
    const { printer } = await fx.makePrinter("srch-printer", { status: PrinterStatus.ONLINE });
    printerId = printer.id;

    const doc0 = await fx.prisma.document.findFirstOrThrow({
      where: { ownerUserId: fx.customer.id, filename: { not: doc.filename } },
    });
    await makeOrder("plain", { documentId: doc0.id });
    await makeOrder("ledger");
    await makeOrder("walkin", {
      customerRecordId: walkIn.id,
      status: OrderStatus.WAITING_FOR_SHOP,
    });
    await makeOrder("unpaid", {
      status: OrderStatus.WAITING_FOR_SHOP,
      payment: PaymentStatus.PENDING,
      documentId: doc0.id,
    });
    // Not yet paid: shops never see these (hidden status), even when asked for by status.
    await makeOrder("hidden", {
      status: OrderStatus.PAYMENT_PENDING,
      payment: PaymentStatus.PENDING,
      documentId: doc0.id,
    });
    await makeOrder("old", { createdAt: new Date("2020-01-15T00:00:00Z"), documentId: doc0.id });
    const printed = await makeOrder("printed", { documentId: doc0.id });
    await fx.prisma.printJob.create({
      data: {
        orderId: printed.id,
        printerId,
        shopId: fx.shop.id,
        branchId: await branchIdOf(fx.prisma, fx.shop.id),
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.QUEUED,
        operatorId: fx.operator.user.id,
        priority: 7,
      },
    });
    // The same tag in ANOTHER business: must never surface for shop A.
    await makeOrder("foreign", { shopId: fx.shopB.id, documentId: doc0.id });
  });

  afterAll(async () => {
    if (fx) {
      await fx.prisma.printJob.deleteMany({ where: { orderId: { in: mine.orderIds } } });
      await fx.prisma.order.deleteMany({ where: { id: { in: mine.orderIds } } });
      await fx.prisma.document.deleteMany({ where: { id: mine.documentId } });
      await fx.prisma.customer.deleteMany({ where: { id: mine.customerRecordId } });
      await fx.cleanup();
    }
  });

  describe("q", () => {
    it("matches the public order number (partial, case-insensitive)", async () => {
      const res = await search({ q: `pa-${tag}-PRIN` });
      expect(res.status).toBe(200);
      expect(numbers(res)).toEqual([numberOf.printed]);
      expect(res.body).toMatchObject({ total: 1, limit: 50, offset: 0 });
    });

    it("matches the document name", async () => {
      const res = await search({ q: `ledger-${tag}` });
      expect(numbers(res).sort()).toEqual([numberOf.ledger, numberOf.walkin].sort());
    });

    it("matches the walk-in customer's name, phone and email", async () => {
      for (const q of [`Zainab Walkin ${tag}`, `0311${tag}`, `zainab.${tag}@`]) {
        const res = await search({ q });
        expect(numbers(res)).toEqual([numberOf.walkin]);
      }
    });

    it("matches the customer account name/email on a web order", async () => {
      const res = await search({ q: fx.customer.email, limit: 100 });
      expect(numbers(res)).toEqual(expect.arrayContaining([numberOf.plain, numberOf.ledger]));
      expect(numbers(res)).not.toContain(numberOf.foreign);
    });

    it("treats % and _ and quotes as literal text, never as wildcards or SQL", async () => {
      for (const q of ["%", "_", "\\", "'; DROP TABLE orders; --", `PA-${tag}-p_ain`]) {
        const res = await search({ q });
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
      }
    });
  });

  describe("filters", () => {
    const base = () => ({ q: `PA-${tag}-`, limit: 100 });

    it("status", async () => {
      expect(numbers(await search({ ...base(), status: "WAITING_FOR_SHOP" })).sort()).toEqual(
        [numberOf.unpaid, numberOf.walkin].sort(),
      );
      const hidden = await search({ ...base(), status: "PAYMENT_PENDING" });
      expect(hidden.body.total).toBe(0);
      expect(numbers(await search(base()))).not.toContain(numberOf.hidden);
    });

    it("paymentStatus", async () => {
      expect(numbers(await search({ ...base(), paymentStatus: "PENDING" }))).toEqual([
        numberOf.unpaid,
      ]);
    });

    it("from / to on createdAt", async () => {
      expect(numbers(await search({ ...base(), to: "2020-12-31T00:00:00Z" }))).toEqual([
        numberOf.old,
      ]);
      const recent = await search({ ...base(), from: "2021-01-01T00:00:00Z" });
      expect(numbers(recent)).not.toContain(numberOf.old);
      expect(recent.body.total).toBe(5);
    });

    it("customerId (walk-in record)", async () => {
      expect(numbers(await search({ ...base(), customerId: walkIn.id }))).toEqual([
        numberOf.walkin,
      ]);
    });

    it("printerId, operatorId and priority (via live jobs)", async () => {
      expect(numbers(await search({ ...base(), printerId }))).toEqual([numberOf.printed]);
      expect(numbers(await search({ ...base(), operatorId: fx.operator.user.id }))).toEqual([
        numberOf.printed,
      ]);
      expect(numbers(await search({ ...base(), priority: 7 }))).toEqual([numberOf.printed]);
      expect((await search({ ...base(), priority: 8 })).body.total).toBe(0);
    });

    it("filters combine with AND, newest first, and page", async () => {
      const page = await search({ ...base(), status: "COMPLETED", limit: 2, offset: 0 });
      expect(page.body).toMatchObject({ total: 4, limit: 2, offset: 0 });
      expect(page.body.items).toHaveLength(2);
      const dates = page.body.items.map((o: { createdAt: string }) => Date.parse(o.createdAt));
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
    });

    it("bad input is a 400", async () => {
      expect((await search({ limit: 101 })).status).toBe(400);
      expect((await search({ offset: -1 })).status).toBe(400);
      expect((await search({ status: "NOPE" })).status).toBe(400);
      expect((await search({ printerId: "not-a-uuid" })).status).toBe(400);
      expect(
        (await search({ from: "2022-01-01T00:00:00Z", to: "2021-01-01T00:00:00Z" })).status,
      ).toBe(400);
      expect((await http().get("/v1/shop/orders/search").set(as(fx.token))).status).toBe(400);
    });
  });

  describe("tenant isolation and permissions", () => {
    it("another business cannot search this shop's orders (403), and sees none of them in its own", async () => {
      expect((await search({ q: `PA-${tag}` }, fx.ownerB.token)).status).toBe(403);
      const own = await http()
        .get("/v1/shop/orders/search")
        .query({ shopId: fx.shopB.id, q: `PA-${tag}-`, limit: 100 })
        .set(as(fx.ownerB.token));
      expect(own.status).toBe(200);
      expect(numbers(own)).toEqual([numberOf.foreign]);
    });

    it("customers and anonymous callers are refused", async () => {
      expect((await search({}, fx.tokens.issueAccessToken(fx.customer))).status).toBe(403);
      expect(
        (await http().get("/v1/shop/orders/search").query({ shopId: fx.shop.id })).status,
      ).toBe(401);
    });

    it("counter staff (VIEW_ORDERS) can search", async () => {
      expect((await search({ q: tag }, fx.counter.token)).status).toBe(200);
    });
  });

  describe("customer order search (GET /v1/orders?q=)", () => {
    it("matches public number and document name, own orders only", async () => {
      const token = fx.tokens.issueAccessToken(fx.customer);
      const byNumber = await http()
        .get("/v1/orders")
        .query({ q: `PA-${tag}-plain`, limit: 10 })
        .set(as(token));
      expect(byNumber.body.total).toBe(1);
      const byDoc = await http()
        .get("/v1/orders")
        .query({ q: `ledger-${tag}`, limit: 10 })
        .set(as(token));
      expect(byDoc.body.total).toBe(2);
      const other = await http()
        .get("/v1/orders")
        .query({ q: `PA-${tag}`, limit: 10 })
        .set(as(fx.ownerB.token));
      expect(other.body.total).toBe(0);
    });
  });

  describe("other list searches escape wildcards and stay tenant-scoped", () => {
    it("inventory items and suppliers: '%' matches nothing, not everything", async () => {
      await fx.prisma.supplier.create({ data: { shopId: fx.shop.id, name: `Acme ${tag}` } });
      const suppliers = await http()
        .get("/v1/shop/suppliers")
        .query({ shopId: fx.shop.id, search: "%" })
        .set(as(fx.token));
      expect(suppliers.status).toBe(200);
      expect(suppliers.body.total).toBe(0);
      const hit = await http()
        .get("/v1/shop/suppliers")
        .query({ shopId: fx.shop.id, search: `acme ${tag}` })
        .set(as(fx.token));
      expect(hit.body.total).toBe(1);
      const items = await http()
        .get("/v1/shop/inventory/items")
        .query({ shopId: fx.shop.id, search: "_" })
        .set(as(fx.token));
      expect(items.status).toBe(200);
      expect(items.body.total).toBe(0);
    });
  });

  describe("rate limit", () => {
    it("search is rate-limited per user (429 RATE_LIMITED with Retry-After)", async () => {
      let last: request.Response | undefined;
      for (let i = 0; i < 61; i += 1) {
        last = await search({ q: `rl-${i}`, limit: 1 }, fx.manager.token);
        if (last.status === 429) break;
      }
      expect(last!.status).toBe(429);
      expect(last!.body.error_code ?? last!.body.errorCode).toBe("RATE_LIMITED");
      expect(last!.headers["retry-after"]).toBeDefined();
    });

    it("ONE per-user budget covers every q search route, and plain (q-less) listing is never throttled", async () => {
      // A fresh manager spends ONE budget across DIFFERENT routes; the 61st search anywhere is refused.
      const rl = await fx.prisma.user.create({
        data: {
          role: "SHOP_MANAGER",
          name: "rl manager",
          email: "rl-" + randomUUID() + "@print-automated.dev",
          passwordHash: "irrelevant",
        },
      });
      await fx.prisma.shopStaff.create({
        data: { shopId: fx.shop.id, userId: rl.id, role: "SHOP_MANAGER", status: "ACTIVE" },
      });
      const rlToken = fx.tokens.issueAccessToken(rl);
      const routes: Array<[string, Record<string, string>]> = [
        ["/v1/shop/customers", { q: "a" }],
        ["/v1/shop/products", { q: "a" }],
        ["/v1/shop/printers", { q: "a" }],
        ["/v1/shop/staff", { q: "a" }],
        ["/v1/shop/inventory/items", { search: "a" }],
        ["/v1/shop/suppliers", { search: "a" }],
      ];
      let refusedAt = -1;
      for (let i = 0; i < 70 && refusedAt < 0; i += 1) {
        const [path, query] = routes[i % routes.length]!;
        const res = await http()
          .get(path)
          .query({ shopId: fx.shop.id, ...query })
          .set(as(rlToken));
        if (res.status === 429) refusedAt = i;
      }
      expect(refusedAt).toBe(60); // calls 0..59 pass, the 61st is refused
      expect((await http().get("/v1/orders").query({ q: "a" }).set(as(rlToken))).status).toBe(429); // the customer route shares the same budget
      // listing without q is not a search: unaffected even while this user is throttled
      const plain = await http()
        .get("/v1/shop/customers")
        .query({ shopId: fx.shop.id })
        .set(as(rlToken));
      expect(plain.status).toBe(200);
      const searched = await http()
        .get("/v1/shop/customers")
        .query({ shopId: fx.shop.id, q: "a" })
        .set(as(rlToken));
      expect(searched.status).toBe(429);
      await fx.prisma.shopStaff.deleteMany({ where: { userId: rl.id } });
      await fx.prisma.user.delete({ where: { id: rl.id } });
    });
  });
});
