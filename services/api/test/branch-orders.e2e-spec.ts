import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import {
  DocumentStatus,
  OrderStatus,
  PrismaClient,
  PrintJobStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { REDIS_CLIENT } from "@print-automated/backend-shared";
import request from "supertest";
import { TokenService } from "../src/auth/token.service.js";
import { PUBLIC_RATE_LIMITS } from "../src/public-orders/public-orders.controller.js";
import { createPhase19Fixture, type Phase19Fixture } from "./helpers/phase19-fixture.js";

const CONFIG = {
  pages: { mode: "all" as const },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

/** Step 3 / B3: where orders are created. A customer who scans branch B's QR code orders from
 * branch B; a code printed before branches existed goes to the oldest branch; a closed or archived
 * branch refuses (while the business's other branches keep taking orders); a closed business
 * refuses every branch; counter staff place orders at their own branch. Everything is created at
 * a SECOND branch, and the first branch must stay empty. */
describe("Orders are created at a branch (step 3 / B3, e2e)", () => {
  let fx: Phase19Fixture;
  let redis: Redis;
  let tokens: TokenService;
  type Member = Awaited<ReturnType<Phase19Fixture["makeMember"]>>;
  let branchB: Awaited<ReturnType<Phase19Fixture["addBranch"]>>;
  let counterB: Member;
  let counterA: Member;
  let managerRoaming: Member;
  let customerToken: string;
  let customerRecordId: string;
  let otherShopId: string;
  let otherShopBranchId: string;

  const http = () => request(fx.app.getHttpServer());
  const as = (member: { token: string }) => ({ Authorization: `Bearer ${member.token}` });
  const qrPath = (suffix = "") => `/v1/public/shops/${fx.shop.id}${suffix}`;

  async function clearPublicRateLimits(): Promise<void> {
    const keys = await redis.keys("ratelimit:PublicOrdersController:*");
    if (keys.length > 0) await redis.del(...keys);
  }

  /** The public two-step upload, then READY by hand (the worker's scan is out of scope here). */
  async function uploadReadyDocument(): Promise<string> {
    const bytes = Buffer.from("%PDF-1.7\nbranch qr order e2e\n%%EOF");
    const created = await http()
      .post(qrPath("/documents"))
      .send({ filename: "qr.pdf", mimeType: "application/pdf", sizeBytes: bytes.length });
    expect(created.status).toBe(201);
    const put = await fetch(created.body.uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(put.ok).toBe(true);
    const documentId: string = created.body.documentId;
    expect((await http().post(qrPath(`/documents/${documentId}/upload`))).status).toBe(200);
    await fx.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.READY, pageCount: 4 },
    });
    return documentId;
  }

  const qrOrder = (documentId: string, extra: Record<string, unknown> = {}) =>
    http()
      .post(qrPath("/orders"))
      .send({
        name: "QR Guest",
        phone: "03001234567",
        documentId,
        printConfiguration: CONFIG,
        ...extra,
      });

  const ordersAt = (branchId: string) =>
    fx.prisma.order.count({ where: { shopId: fx.shop.id, branchId } });

  beforeAll(async () => {
    fx = await createPhase19Fixture("bord", { multiItemEnabled: false });
    redis = fx.app.get<Redis>(REDIS_CLIENT);
    tokens = fx.app.get(TokenService);
    await clearPublicRateLimits();

    await fx.prisma.shop.update({
      where: { id: fx.shop.id },
      data: { capabilities: { color: true, duplex: true, a4: true, a3: false } },
    });
    await fx.prisma.pricingRule.create({
      data: {
        shopId: fx.shop.id,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      },
    });
    branchB = await fx.addBranch("B");
    counterA = await fx.makeMember(UserRole.SHOP_COUNTER, fx.branch.id);
    counterB = await fx.makeMember(UserRole.SHOP_COUNTER, branchB.id);
    managerRoaming = await fx.makeMember(UserRole.SHOP_MANAGER, null);
    customerToken = tokens.issueAccessToken(fx.customer);
    const record = await fx.prisma.customer.create({
      data: { shopId: fx.shop.id, name: "Walk-in", phone: "03000000000" },
    });
    customerRecordId = record.id;

    const other = await fx.prisma.shop.create({
      data: { name: `bord other ${randomUUID()}`, address: "9 Elsewhere", status: ShopStatus.OPEN },
    });
    otherShopId = other.id;
    otherShopBranchId = (await fx.prisma.branch.findFirstOrThrow({ where: { shopId: other.id } }))
      .id;
  }, 60_000);

  afterAll(async () => {
    await clearPublicRateLimits();
    const shop = await fx.prisma.shop.findUnique({
      where: { id: fx.shop.id },
      select: { qrSystemUserId: true },
    });
    await fx.prisma.shop.deleteMany({ where: { id: otherShopId } });
    await fx.cleanup();
    // What the QR flow created outside the fixture: the shop's SYSTEM user and that user's
    // documents and audit rows. cleanup() has already removed the orders that referenced them.
    if (shop?.qrSystemUserId) {
      const prisma = new PrismaClient();
      try {
        const id = shop.qrSystemUserId;
        await prisma.document.deleteMany({ where: { ownerUserId: id } });
        await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: id }, { resourceId: id }] } });
        await prisma.user.deleteMany({ where: { id } });
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  describe("a customer scanning a branch's QR code", () => {
    it("orders from the branch on the code, and nothing lands in the first branch", async () => {
      const before = await ordersAt(fx.branch.id);
      const documentId = await uploadReadyDocument();
      const res = await qrOrder(documentId, { branchId: branchB.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ branchId: branchB.id, branchName: branchB.name });

      const order = await fx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(order.branchId).toBe(branchB.id);
      expect(await ordersAt(fx.branch.id)).toBe(before);

      const audit = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: "QR_ORDER_CREATED", resourceId: order.id },
      });
      expect(audit.metadata).toMatchObject({ branchId: branchB.id });
    });

    it("sends an old code, with no branch on it, to the oldest branch", async () => {
      const documentId = await uploadReadyDocument();
      const res = await qrOrder(documentId);
      expect(res.status).toBe(201);
      expect(res.body.branchId).toBe(fx.branch.id);
      expect(res.body.branchName).toBe(fx.branch.name);
    });

    it("refuses a closed branch (409 BRANCH_CLOSED) while the other branch still accepts", async () => {
      await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: false } });
      try {
        const customersBefore = await fx.prisma.customer.count({ where: { shopId: fx.shop.id } });
        const refused = await qrOrder(await uploadReadyDocument(), { branchId: branchB.id });
        expect(refused.status).toBe(409);
        expect(refused.body.error_code).toBe("BRANCH_CLOSED");
        // Refused before the guest's Customer row was written.
        expect(await fx.prisma.customer.count({ where: { shopId: fx.shop.id } })).toBe(
          customersBefore,
        );

        const accepted = await qrOrder(await uploadReadyDocument(), { branchId: fx.branch.id });
        expect(accepted.status).toBe(201);
        expect(accepted.body.branchId).toBe(fx.branch.id);
      } finally {
        await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: true } });
      }
    });

    it("refuses an old code (no branch) when the oldest branch itself is closed", async () => {
      await fx.prisma.branch.update({ where: { id: fx.branch.id }, data: { isOpen: false } });
      try {
        const refused = await qrOrder(await uploadReadyDocument());
        expect(refused.status).toBe(409);
        expect(refused.body.error_code).toBe("BRANCH_CLOSED");
      } finally {
        await fx.prisma.branch.update({ where: { id: fx.branch.id }, data: { isOpen: true } });
      }
    });

    it("refuses every branch when the business itself is closed", async () => {
      const documentId = await uploadReadyDocument();
      await fx.prisma.shop.update({
        where: { id: fx.shop.id },
        data: { status: ShopStatus.CLOSED },
      });
      try {
        for (const extra of [{ branchId: fx.branch.id }, { branchId: branchB.id }, {}]) {
          const res = await qrOrder(documentId, extra);
          expect(res.status).toBe(409);
          expect(res.body.error_code).toBe("SHOP_NOT_ACCEPTING_ORDERS");
        }
      } finally {
        await fx.prisma.shop.update({
          where: { id: fx.shop.id },
          data: { status: ShopStatus.OPEN },
        });
      }
    });

    it("refuses an archived branch (409) and another business's branch (400)", async () => {
      const spare = await fx.addBranch("Spare");
      await fx.prisma.branch.update({ where: { id: spare.id }, data: { archivedAt: new Date() } });
      const documentId = await uploadReadyDocument();
      const archived = await qrOrder(documentId, { branchId: spare.id });
      expect(archived.status).toBe(409);
      expect(archived.body.error_code).toBe("BRANCH_ARCHIVED");

      const foreign = await qrOrder(documentId, { branchId: otherShopBranchId });
      expect(foreign.status).toBe(400);
      expect(foreign.body.error_code).toBe("BRANCH_NOT_FOUND");
    });

    it("an old code skips an archived oldest branch", async () => {
      await fx.prisma.branch.update({
        where: { id: fx.branch.id },
        data: { archivedAt: new Date() },
      });
      try {
        const res = await qrOrder(await uploadReadyDocument());
        expect(res.status).toBe(201);
        expect(res.body.branchId).toBe(branchB.id);
      } finally {
        await fx.prisma.branch.update({ where: { id: fx.branch.id }, data: { archivedAt: null } });
      }
    });
  });

  describe("the public branch page behind the QR code", () => {
    it("tells a visitor which branch they are ordering from, and whether it is open", async () => {
      const res = await http().get(qrPath(`/branches/${branchB.id}`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: branchB.id,
        name: branchB.name,
        city: branchB.city,
        address: branchB.address,
        isOpen: true,
      });

      await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: false } });
      try {
        const closed = await http().get(qrPath(`/branches/${branchB.id}`));
        expect(closed.status).toBe(200);
        expect(closed.body.isOpen).toBe(false);
      } finally {
        await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: true } });
      }
    });

    it("is a 404 for an unknown branch and for another business's, so it confirms nothing about them", async () => {
      expect((await http().get(qrPath(`/branches/${randomUUID()}`))).status).toBe(404);
      expect((await http().get(qrPath(`/branches/${otherShopBranchId}`))).status).toBe(404);
      expect((await http().get(qrPath("/branches/not-a-uuid"))).status).toBe(400);
    });

    it("says an archived branch of this business is gone (410), so a guest is not silently sent elsewhere", async () => {
      const spare = await fx.addBranch("Gone");
      await fx.prisma.branch.update({ where: { id: spare.id }, data: { archivedAt: new Date() } });
      const res = await http().get(qrPath(`/branches/${spare.id}`));
      expect(res.status).toBe(410);
      expect(res.body.error_code).toBe("BRANCH_ARCHIVED");
    });

    it("is rate limited like the other public routes", async () => {
      await clearPublicRateLimits();
      try {
        const limit = PUBLIC_RATE_LIMITS.getBranch.perIpAndShop;
        for (let i = 0; i < limit; i += 1) {
          expect((await http().get(qrPath(`/branches/${branchB.id}`))).status).toBe(200);
        }
        expect((await http().get(qrPath(`/branches/${branchB.id}`))).status).toBe(429);
      } finally {
        await clearPublicRateLimits();
      }
    });

    it("needs no sign-in and gives away nothing but the public fields", async () => {
      const res = await http().get(qrPath(`/branches/${branchB.id}`));
      expect(Object.keys(res.body).sort()).toEqual(["address", "city", "id", "isOpen", "name"]);
    });
  });

  describe("a signed-in customer ordering from the web (POST /orders)", () => {
    const order = (extra: Record<string, unknown> = {}) =>
      http()
        .post("/v1/orders")
        .set({ Authorization: `Bearer ${customerToken}`, "Idempotency-Key": randomUUID() })
        .send({
          shopId: fx.shop.id,
          documentId: fx.document.id,
          printConfiguration: CONFIG,
          ...extra,
        });

    it("takes the branch named in the body, and the oldest branch when none is", async () => {
      const named = await order({ branchId: branchB.id });
      expect(named.status).toBe(201);
      expect(named.body).toMatchObject({ branchId: branchB.id, branchName: branchB.name });
      const unnamed = await order();
      expect(unnamed.status).toBe(201);
      expect(unnamed.body.branchId).toBe(fx.branch.id);
    });

    it("refuses a closed branch, an archived one and another business's", async () => {
      await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: false } });
      try {
        const closed = await order({ branchId: branchB.id });
        expect(closed.status).toBe(409);
        expect(closed.body.error_code).toBe("BRANCH_CLOSED");
      } finally {
        await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: true } });
      }
      const foreign = await order({ branchId: otherShopBranchId });
      expect(foreign.status).toBe(400);
      expect(foreign.body.error_code).toBe("BRANCH_NOT_FOUND");
    });

    it("a quote does not take a branch (prices are shared)", async () => {
      const res = await http()
        .post("/v1/orders/quote")
        .set({ Authorization: `Bearer ${customerToken}` })
        .send({ shopId: fx.shop.id, documentId: fx.document.id, printConfiguration: CONFIG });
      expect(res.status).toBe(200);
    });
  });

  describe("counter orders (POST /shop/orders)", () => {
    // A counter order uses a document the staff member uploaded themselves.
    const documents = new Map<string, string>();
    async function documentOf(member: { user: { id: string } }): Promise<string> {
      const known = documents.get(member.user.id);
      if (known) return known;
      const doc = await fx.prisma.document.create({
        data: {
          ownerUserId: member.user.id,
          storageKey: `test/bord/${randomUUID()}`,
          filename: "counter.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          pageCount: 4,
          status: DocumentStatus.READY,
        },
      });
      fx.trackDocument(doc.id);
      documents.set(member.user.id, doc.id);
      return doc.id;
    }
    const counter = async (
      member: { token: string; user: { id: string } },
      extra: Record<string, unknown> = {},
    ) =>
      http()
        .post("/v1/shop/orders")
        .set(as(member))
        .send({
          shopId: fx.shop.id,
          documentId: await documentOf(member),
          customerRecordId,
          printConfiguration: CONFIG,
          ...extra,
        });

    it("a branch-bound person's order is placed at their own branch", async () => {
      const mine = await counter(counterB);
      expect(mine.status).toBe(201);
      expect(mine.body).toMatchObject({ branchId: branchB.id, creationSource: "COUNTER" });
      const first = await counter(counterA);
      expect(first.status).toBe(201);
      expect(first.body.branchId).toBe(fx.branch.id);
    });

    it("a branch-bound person cannot place an order at another branch", async () => {
      const before = await ordersAt(fx.branch.id);
      const res = await counter(counterB, { branchId: fx.branch.id });
      expect(res.status).toBe(403);
      expect(await ordersAt(fx.branch.id)).toBe(before);
    });

    it("an all-branches person names the branch, and is asked when there are several and none is named", async () => {
      const named = await counter({ token: fx.token, user: fx.owner }, { branchId: branchB.id });
      expect(named.status).toBe(201);
      expect(named.body.branchId).toBe(branchB.id);
      const roaming = await counter(managerRoaming, { branchId: fx.branch.id });
      expect(roaming.status).toBe(201);
      expect(roaming.body.branchId).toBe(fx.branch.id);

      const asked = await counter({ token: fx.token, user: fx.owner });
      expect(asked.status).toBe(400);
      expect(asked.body.error_code).toBe("BRANCH_REQUIRED");
    });

    it("staff can still key an order in at a closed branch, but not an archived one", async () => {
      await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: false } });
      try {
        const closed = await counter(counterB);
        expect(closed.status).toBe(201);
        expect(closed.body.branchId).toBe(branchB.id);
      } finally {
        await fx.prisma.branch.update({ where: { id: branchB.id }, data: { isOpen: true } });
      }
      const spare = await fx.addBranch("Archived");
      await fx.prisma.branch.update({ where: { id: spare.id }, data: { archivedAt: new Date() } });
      const archived = await counter({ token: fx.token, user: fx.owner }, { branchId: spare.id });
      expect(archived.status).toBe(409);
      expect(archived.body.error_code).toBe("BRANCH_ARCHIVED");
    });

    it("a business with one branch needs no branch named", async () => {
      const single = await createPhase19Fixture("bordone", { multiItemEnabled: false });
      try {
        await single.prisma.shop.update({
          where: { id: single.shop.id },
          data: { capabilities: { color: true, duplex: true, a4: true, a3: false } },
        });
        await single.prisma.pricingRule.create({
          data: {
            shopId: single.shop.id,
            version: 1,
            currency: "PKR",
            pricePerPageMinor: 1000,
            colorSurchargePerPageMinor: 0,
            otherCharges: [],
            minimumChargeMinor: 1000,
          },
        });
        const record = await single.prisma.customer.create({
          data: { shopId: single.shop.id, name: "Solo", phone: "03111111111" },
        });
        const ownDocument = await single.prisma.document.create({
          data: {
            ownerUserId: single.owner.id,
            storageKey: `test/bordone/${randomUUID()}`,
            filename: "solo.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            pageCount: 4,
            status: DocumentStatus.READY,
          },
        });
        single.trackDocument(ownDocument.id);
        const res = await request(single.app.getHttpServer())
          .post("/v1/shop/orders")
          .set({ Authorization: `Bearer ${single.token}` })
          .send({
            shopId: single.shop.id,
            documentId: ownDocument.id,
            customerRecordId: record.id,
            printConfiguration: CONFIG,
          });
        expect(res.status).toBe(201);
        expect(res.body.branchId).toBe(single.branch.id);
      } finally {
        await single.cleanup();
      }
    });
  });

  describe("from the QR code to the printer, all at the second branch", () => {
    it("an order placed through branch B's code is accepted onto B's printer, and A stays empty", async () => {
      const printerA = (await fx.makePrinter("bord-A", {}, fx.branch.id)).printer;
      const printerB = (await fx.makePrinter("bord-B", {}, branchB.id)).printer;
      const jobsBeforeA = await fx.prisma.printJob.count({
        where: { shopId: fx.shop.id, branchId: fx.branch.id },
      });

      const placed = await qrOrder(await uploadReadyDocument(), { branchId: branchB.id });
      expect(placed.status).toBe(201);
      const orderId: string = placed.body.id;

      // The guest pays at the counter of branch B; a manager there takes the order.
      const manager = await fx.makeMember(UserRole.SHOP_MANAGER, branchB.id);
      const paid = await http()
        .post(`/v1/shop/orders/${orderId}/record-payment`)
        .set(as(manager))
        .send({});
      expect(paid.status).toBe(200);
      const accepted = await http()
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set(as(manager))
        .send({});
      expect(accepted.status).toBe(200);

      const jobs = await fx.prisma.printJob.findMany({ where: { orderId } });
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.every((j) => j.branchId === branchB.id)).toBe(true);
      expect(jobs.every((j) => j.printerId === printerB.id)).toBe(true);
      expect(jobs.some((j) => j.printerId === printerA.id)).toBe(false);
      expect(
        await fx.prisma.printJob.count({ where: { shopId: fx.shop.id, branchId: fx.branch.id } }),
      ).toBe(jobsBeforeA);
      expect(jobs.every((j) => j.status === PrintJobStatus.QUEUED)).toBe(true);
      const order = await fx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.orderStatus).not.toBe(OrderStatus.UPLOADED);
      expect(order.branchId).toBe(branchB.id);
    });
  });
});
