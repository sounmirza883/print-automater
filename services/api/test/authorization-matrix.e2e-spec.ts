import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  PrinterStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { TokenService } from "../src/auth/token.service.js";
import { AgentPairingCodeService } from "../src/shop-agents/agent-pairing-code.service.js";

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

const SHOP_STAFF_ROLES = [
  UserRole.SHOP_OWNER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_COUNTER,
] as const;

/** §122/12.1: "Shop A staff cannot reach any shop B resource by any
 * route. Every cell in the matrix is asserted, not sampled." One
 * shared fixture (2 shops x 3 staff roles, 2 customers, 1 admin, 1
 * printer + 1 agent per shop) reused across the whole file, following
 * the exact patterns already established elsewhere in this suite
 * (shop-scope/shop-orders/printers/agent-*.e2e-spec.ts) rather than
 * re-deriving them -- this file's own job is to hold every resource x
 * role x ownership cell side by side in one place, the same
 * consolidation reasoning 10.6's own campaign suite already used for
 * duplicate-protection.
 *
 * Two deliberately different denial shapes exist side by side in this
 * codebase, and this suite asserts each route against the shape it
 * actually uses rather than assuming one uniform convention:
 *   - ShopScopeGuard-guarded routes (shop-orders mutations, printer
 *     update/delete) 403 on a nonexistent OR cross-shop resource alike
 *     -- the guard never leaks which case it is (shop-scope.e2e-spec.ts
 *     already proves this for the guard itself; here it's proven per
 *     real route).
 *   - Customer-ownership routes (orders, documents) and agent
 *     job/document routes deliberately keep a real distinction:
 *     404 for "doesn't exist," 403 (customer) or 404-as-not-mine
 *     (agent) for "exists, not yours."
 *
 * ADMIN has no special-cased route or bypass anywhere in this codebase
 * (grepped: zero `UserRole.ADMIN` references in any `@Roles()` call or
 * service-level check) -- "admin web" is explicitly out of MVP scope.
 * Every admin-role assertion below therefore expects the SAME denial a
 * non-owning/non-staff user would get, never elevated access; this is
 * intentional, current-state behavior, not an oversight.
 *
 * No shop-facing document route exists at all (documents.service.ts's
 * own comment still says so) -- the shop_staff x document cell is
 * genuinely N/A for MVP, not merely untested, and is omitted rather
 * than faked. */
describe("Authorization matrix (12.1, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let pairingCodeService: AgentPairingCodeService;

  let shopA: { id: string };
  let shopB: { id: string };
  const staffTokens: Record<string, Record<string, string>> = { A: {}, B: {} };
  let adminToken: string;
  let customerOwner: { id: string; role: UserRole };
  let customerOwnerToken: string;
  let customerStranger: { id: string; role: UserRole };
  let customerStrangerToken: string;
  let ownerDocumentId: string;
  let ownerOrderId: string;
  let printerA: { id: string };
  let agentA: { deviceId: string; accessToken: string };
  let agentB: { deviceId: string; accessToken: string };
  /** One shop-A order, any legal-ish state, reused for every
   * cross-shop *mutation* 403 check -- NestJS runs guards before the
   * controller body (and before the state machine ever sees the
   * request), so a cross-shop denial fires purely off `order.shopId`,
   * identical regardless of the order's own status or the request
   * body. Reusing one fixture order here is a deliberate, correct
   * simplification, not under-testing -- the guard-level 403 for each
   * of the seven mutation routes below only requires it exist. */
  let shopAOrderId: string;

  const orderIds: string[] = [];
  const documentIds: string[] = [];
  const printerIds: string[] = [];
  const deviceIds: string[] = [];
  const printJobIds: string[] = [];

  async function registerAgent(
    shopId: string,
    staffUserId: string,
  ): Promise<{ deviceId: string; accessToken: string }> {
    const { code } = await pairingCodeService.issue(shopId, staffUserId);
    const { publicKeyBase64Url, privateKey } = generateAgentKeypair();
    const deviceId = randomUUID();
    deviceIds.push(deviceId);

    await request(app.getHttpServer())
      .post("/v1/agents/register")
      .send({ pairingCode: code, deviceId, publicKey: publicKeyBase64Url })
      .expect(201);
    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    const signature = signNonce(privateKey, challenge.body.nonce as string);
    const auth = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature });
    return { deviceId, accessToken: auth.body.accessToken as string };
  }

  async function createPrinterForAgent(
    shopId: string,
    deviceId: string,
    name: string,
  ): Promise<{ id: string }> {
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    const printer = await prisma.printer.create({
      data: { shopId, agentId: agent.id, name, status: PrinterStatus.ONLINE },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function seedOrder(
    shopId: string,
    customerId: string,
    documentId: string,
    orderStatus: OrderStatus,
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-AUTHZ-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 1000, currency: "PKR" } },
        orderStatus,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  async function seedJob(
    printerId: string,
    shopId: string,
    orderId: string,
    status: PrintJobStatus,
  ): Promise<string> {
    const job = await prisma.printJob.create({
      data: { orderId, printerId, shopId, idempotencyToken: randomUUID(), status },
    });
    printJobIds.push(job.id);
    return job.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    pairingCodeService = app.get(AgentPairingCodeService);

    shopA = await prisma.shop.create({
      data: { name: `Authz Matrix Shop A ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopB = await prisma.shop.create({
      data: { name: `Authz Matrix Shop B ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
    });

    let firstStaffAId = "";
    for (const [label, shop] of [
      ["A", shopA],
      ["B", shopB],
    ] as const) {
      for (const role of SHOP_STAFF_ROLES) {
        const user = await prisma.user.create({
          data: {
            role,
            name: `Authz Matrix ${label} ${role}`,
            email: `authz-matrix-${label}-${role}-${randomUUID()}@print-automated.dev`,
            passwordHash: "irrelevant",
          },
        });
        await prisma.shopStaff.create({
          data: { shopId: shop.id, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
        });
        staffTokens[label]![role] = tokenService.issueAccessToken(user);
        if (label === "A" && role === UserRole.SHOP_OWNER) {
          firstStaffAId = user.id;
        }
      }
    }

    const admin = await prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Authz Matrix Admin",
        email: `authz-matrix-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    adminToken = tokenService.issueAccessToken(admin);

    customerOwner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Authz Matrix Customer Owner",
        email: `authz-matrix-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerOwnerToken = tokenService.issueAccessToken(customerOwner);
    customerStranger = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Authz Matrix Customer Stranger",
        email: `authz-matrix-stranger-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerStrangerToken = tokenService.issueAccessToken(customerStranger);

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerOwner.id,
        storageKey: `test/authz-matrix/${randomUUID()}`,
        filename: "authz-matrix-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    ownerDocumentId = document.id;
    documentIds.push(document.id);

    ownerOrderId = await seedOrder(
      shopA.id,
      customerOwner.id,
      ownerDocumentId,
      OrderStatus.WAITING_FOR_SHOP,
    );
    shopAOrderId = await seedOrder(
      shopA.id,
      customerOwner.id,
      ownerDocumentId,
      OrderStatus.WAITING_FOR_SHOP,
    );

    agentA = await registerAgent(shopA.id, firstStaffAId);
    printerA = await createPrinterForAgent(
      shopA.id,
      agentA.deviceId,
      `Authz Matrix Printer A ${randomUUID()}`,
    );
    const firstStaffBId = (
      await prisma.shopStaff.findFirstOrThrow({
        where: { shopId: shopB.id, role: UserRole.SHOP_OWNER },
      })
    ).userId;
    agentB = await registerAgent(shopB.id, firstStaffBId);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { id: { in: printJobIds } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    // Shop delete cascades printer/printerAgent/shopStaff/agentPairingCode
    // (all `onDelete: Cascade` on their own shopId FK); user delete
    // cascades any leftover document/shopStaff. No need to list those
    // tables separately.
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await prisma.user.deleteMany({ where: { email: { contains: "authz-matrix-" } } });
    await app.close();
  });

  // ---------------------------------------------------------------
  // Customer resources: orders
  // ---------------------------------------------------------------
  describe("orders (customer routes)", () => {
    it("customer x own x order: list and detail succeed", async () => {
      const list = await request(app.getHttpServer())
        .get("/v1/orders")
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(list.status).toBe(200);
      expect((list.body as Array<{ id: string }>).some((o) => o.id === ownerOrderId)).toBe(true);

      const detail = await request(app.getHttpServer())
        .get(`/v1/orders/${ownerOrderId}`)
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(detail.status).toBe(200);
    });

    it("customer x other-customer x order: 403, not a leaking 404", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/orders/${ownerOrderId}`)
        .set("Authorization", `Bearer ${customerStrangerToken}`);
      expect(res.status).toBe(403);
    });

    it("customer x nonexistent x order: 404 (distinct from the 403 above)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/orders/${randomUUID()}`)
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(res.status).toBe(404);
    });

    it("admin x other-customer x order: denied exactly like a non-owner, never elevated", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/orders/${ownerOrderId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it("no token: 401", async () => {
      const res = await request(app.getHttpServer()).get(`/v1/orders/${ownerOrderId}`);
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------
  // Customer resources: documents
  // ---------------------------------------------------------------
  describe("documents (customer routes)", () => {
    it("customer x own x document: 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${ownerDocumentId}`)
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(res.status).toBe(200);
    });

    it("customer x other-customer x document: 403", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${ownerDocumentId}`)
        .set("Authorization", `Bearer ${customerStrangerToken}`);
      expect(res.status).toBe(403);
    });

    it("customer x nonexistent x document: 404", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${randomUUID()}`)
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(res.status).toBe(404);
    });

    it("admin x other-customer x document: denied exactly like a non-owner", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${ownerDocumentId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it("shop_staff has no route to reach a document at all (N/A cell, not untested)", () => {
      // documents.service.ts's own comment: no shop-facing document
      // read/download route exists for MVP. Nothing to call here.
    });
  });

  // ---------------------------------------------------------------
  // Shop-staff resources: orders (read)
  // ---------------------------------------------------------------
  describe("orders (shop-staff read routes)", () => {
    it.each(SHOP_STAFF_ROLES)(
      "%s x own-shop x order: list (query-param) and detail (route-param) succeed",
      async (role) => {
        const token = staffTokens.A![role]!;
        const list = await request(app.getHttpServer())
          .get(`/v1/shop/orders?shopId=${shopA.id}`)
          .set("Authorization", `Bearer ${token}`);
        expect(list.status).toBe(200);

        const detail = await request(app.getHttpServer())
          .get(`/v1/shop/orders/${shopAOrderId}`)
          .set("Authorization", `Bearer ${token}`);
        expect(detail.status).toBe(200);
      },
    );

    it.each(SHOP_STAFF_ROLES)(
      "%s x other-shop x order: list (query-param) and detail (route-param) both 403 -- same denial regardless of staff role, since RolesGuard/ShopMembershipService never check *which* staff role, only that one applies",
      async (role) => {
        const token = staffTokens.B![role]!;
        const list = await request(app.getHttpServer())
          .get(`/v1/shop/orders?shopId=${shopA.id}`)
          .set("Authorization", `Bearer ${token}`);
        expect(list.status).toBe(403);

        const detail = await request(app.getHttpServer())
          .get(`/v1/shop/orders/${shopAOrderId}`)
          .set("Authorization", `Bearer ${token}`);
        expect(detail.status).toBe(403);
      },
    );

    it("customer x shop-orders route: 403 (role gate)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders?shopId=${shopA.id}`)
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(res.status).toBe(403);
    });

    it("admin x shop-orders route: 403 -- admin is not in @Roles(SHOP_COUNTER, SHOP_MANAGER, SHOP_OWNER) either", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders?shopId=${shopA.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Shop-staff resources: orders (mutations) -- the genuinely new
  // cross-shop coverage: only `accept` had a direct cross-shop test
  // anywhere in the existing suite before this file. All seven share
  // the identical ShopScopeGuard + OrderShopResolver pair, so each
  // gets its own direct assertion here per 12.1's own "every cell
  // asserted, not sampled," reusing the one shopAOrderId fixture (see
  // its own comment above for why that's correct, not under-testing).
  // ---------------------------------------------------------------
  describe("orders (shop-staff mutation routes) -- cross-shop denial", () => {
    const shopBCounterToken = () => staffTokens.B![UserRole.SHOP_COUNTER]!;

    it("accept: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/accept`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`);
      expect(res.status).toBe(403);
    });

    it("reject: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/reject`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`)
        .send({ reason: "PRINTER_UNAVAILABLE" });
      expect(res.status).toBe(403);
    });

    it("ready: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/ready`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`);
      expect(res.status).toBe(403);
    });

    it("complete: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/complete`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`);
      expect(res.status).toBe(403);
    });

    it("retry-print: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/retry-print`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`);
      expect(res.status).toBe(403);
    });

    it("resolve-unknown: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/resolve-unknown`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`)
        .send({ resolution: "MARK_FAILED" });
      expect(res.status).toBe(403);
    });

    it("change-printer: 403 for shop B staff targeting a shop A order", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${shopAOrderId}/change-printer`)
        .set("Authorization", `Bearer ${shopBCounterToken()}`)
        .send({ printerId: printerA.id });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Shop-staff resources: printers
  // ---------------------------------------------------------------
  describe("printers (shop-staff routes)", () => {
    it("own-shop x printer: list/register/update/delete all succeed (SHOP_OWNER -- has MANAGE_PRINTERS)", async () => {
      const token = staffTokens.A![UserRole.SHOP_OWNER]!;
      const list = await request(app.getHttpServer())
        .get(`/v1/shop/printers?shopId=${shopA.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(list.status).toBe(200);

      const registered = await request(app.getHttpServer())
        .post("/v1/shop/printers")
        .set("Authorization", `Bearer ${token}`)
        .send({ shopId: shopA.id, name: `Authz Matrix Scratch Printer ${randomUUID()}` });
      expect(registered.status).toBe(201);
      printerIds.push(registered.body.id as string);

      const updated = await request(app.getHttpServer())
        .patch(`/v1/shop/printers/${registered.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Renamed" });
      expect(updated.status).toBe(200);

      const deleted = await request(app.getHttpServer())
        .delete(`/v1/shop/printers/${registered.body.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(deleted.status).toBe(204);
    });

    it("other-shop x printer: list/register/update/delete all 403", async () => {
      const token = staffTokens.B![UserRole.SHOP_COUNTER]!;
      const list = await request(app.getHttpServer())
        .get(`/v1/shop/printers?shopId=${shopA.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(list.status).toBe(403);

      const registered = await request(app.getHttpServer())
        .post("/v1/shop/printers")
        .set("Authorization", `Bearer ${token}`)
        .send({ shopId: shopA.id, name: "Should not register" });
      expect(registered.status).toBe(403);

      const updated = await request(app.getHttpServer())
        .patch(`/v1/shop/printers/${printerA.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Should not rename" });
      expect(updated.status).toBe(403);

      const deleted = await request(app.getHttpServer())
        .delete(`/v1/shop/printers/${printerA.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(deleted.status).toBe(403);
    });

    /** §47/16.3's own Done-when: same shop, lower-privilege role
     * blocked from what SHOP_OWNER (above) can do -- for
     * register/update/delete, which genuinely change the fleet. `list`
     * is a read, deliberately excluded from MANAGE_PRINTERS (fixed
     * post-Phase-17, see printers.controller.ts's own comment): a
     * SHOP_COUNTER needs to read the printer list to use the "Change
     * Printer" picker on an order they can already retry
     * (EDIT_ORDERS), so it gets its own 200 assertion below instead of
     * being lumped in with the writes. */
    it("own-shop x printer, SHOP_COUNTER: register/update/delete all 403 (lacks MANAGE_PRINTERS)", async () => {
      const token = staffTokens.A![UserRole.SHOP_COUNTER]!;
      const registered = await request(app.getHttpServer())
        .post("/v1/shop/printers")
        .set("Authorization", `Bearer ${token}`)
        .send({ shopId: shopA.id, name: "Should not register" });
      expect(registered.status).toBe(403);

      const updated = await request(app.getHttpServer())
        .patch(`/v1/shop/printers/${printerA.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Should not rename" });
      expect(updated.status).toBe(403);

      const deleted = await request(app.getHttpServer())
        .delete(`/v1/shop/printers/${printerA.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(deleted.status).toBe(403);
    });

    it("own-shop x printer, SHOP_COUNTER: list succeeds (200) -- reading is not a MANAGE_PRINTERS action", async () => {
      const token = staffTokens.A![UserRole.SHOP_COUNTER]!;
      const list = await request(app.getHttpServer())
        .get(`/v1/shop/printers?shopId=${shopA.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(list.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------
  // Role gates: shop/staff/me and shop/agents/pairing-code
  // ---------------------------------------------------------------
  describe("role gates on other shop-staff-only routes", () => {
    it("customer x /shop/staff/me: 403", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/shop/staff/me")
        .set("Authorization", `Bearer ${customerOwnerToken}`);
      expect(res.status).toBe(403);
    });

    it("shop A staff requesting a shop-B pairing code: 403 (not a shop staff member there)", async () => {
      const res = await request(app.getHttpServer())
        .post("/v1/shop/agents/pairing-code")
        .set("Authorization", `Bearer ${staffTokens.A![UserRole.SHOP_COUNTER]!}`)
        .send({ shopId: shopB.id });
      expect(res.status).toBe(403);
    });

    it("admin x /shop/agents/pairing-code: 403 (role gate, not staff at either shop)", async () => {
      const res = await request(app.getHttpServer())
        .post("/v1/shop/agents/pairing-code")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ shopId: shopA.id });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Agent resources: jobs & documents -- CROSS-SHOP (the genuinely new
  // coverage: existing agent-jobs/agent-job-status/agent-document specs
  // only ever proved cross-*agent*-same-shop isolation, never
  // cross-shop. Every agent-side check goes through the Prisma
  // relation `printer: { agent: { deviceId } }`, not a separate
  // resolver, so a shop-B agent reaching a shop-A job must 404 the
  // same way a stranger-agent-same-shop already does -- proven here
  // directly rather than assumed from the same-shop case.
  // ---------------------------------------------------------------
  describe("agent jobs & documents -- cross-shop denial", () => {
    it("claim: agent at shop B cannot claim a job queued for shop A's printer (404, not 403 -- the job legitimately doesn't exist *for this agent*)", async () => {
      const jobId = await seedJob(printerA.id, shopA.id, shopAOrderId, PrintJobStatus.QUEUED);
      const res = await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/claim`)
        .set("Authorization", `Bearer ${agentB.accessToken}`);
      expect(res.status).toBe(404);

      const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.status).toBe(PrintJobStatus.QUEUED);
    });

    it("status report: agent at shop B cannot report status on a shop A job (404)", async () => {
      const jobId = await seedJob(printerA.id, shopA.id, shopAOrderId, PrintJobStatus.CLAIMED);
      const res = await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/status`)
        .set("Authorization", `Bearer ${agentB.accessToken}`)
        .send({ status: "PRINTED" });
      expect(res.status).toBe(404);
    });

    it("document download: agent at shop B cannot fetch the document for a shop A job (404)", async () => {
      const jobId = await seedJob(printerA.id, shopA.id, shopAOrderId, PrintJobStatus.CLAIMED);
      const res = await request(app.getHttpServer())
        .get(`/v1/agents/jobs/${jobId}/document`)
        .set("Authorization", `Bearer ${agentB.accessToken}`);
      expect(res.status).toBe(404);
    });

    it("same-shop, own printer: shop A's own agent can claim its own queued job (positive control, proves the above 404s are genuine denial, not a broken route)", async () => {
      const jobId = await seedJob(printerA.id, shopA.id, shopAOrderId, PrintJobStatus.QUEUED);
      const res = await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/claim`)
        .set("Authorization", `Bearer ${agentA.accessToken}`);
      expect(res.status).toBe(200);
    });
  });
  // ---------------------------------------------------------------
  // Phase 23 surfaces (dashboards, reports, search, notification centre).
  // Table-driven: every route x {owner, manager, counter} of shop A x
  // {shop B staff, admin, anonymous}. Each cell is asserted.
  // ---------------------------------------------------------------
  describe("phase 23 read surfaces", () => {
    type Cell = { owner: number; manager: number; counter: number };
    const SHOP_ROUTES: Array<{ name: string; path: string; expected: Cell }> = [
      {
        name: "owner dashboard",
        path: "/v1/shop/dashboard/owner",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "operator dashboard",
        path: "/v1/shop/dashboard/operator",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "printer dashboard",
        path: "/v1/shop/dashboard/printers",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "orders report",
        path: "/v1/shop/reports/orders",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "revenue report",
        path: "/v1/shop/reports/revenue",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "printing-volume report",
        path: "/v1/shop/reports/printing-volume",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "printers report",
        path: "/v1/shop/reports/printers",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "operator-workload report",
        path: "/v1/shop/reports/operator-workload",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "paper-consumption report",
        path: "/v1/shop/reports/paper-consumption",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
      {
        name: "supplier-purchases report",
        path: "/v1/shop/reports/supplier-purchases",
        expected: { owner: 200, manager: 200, counter: 403 },
      },
    ];

    describe.each(SHOP_ROUTES)("$name", ({ path, expected }) => {
      const get = (token: string | null, shopId: string) => {
        const r = request(app.getHttpServer()).get(path).query({ shopId });
        return token ? r.set("Authorization", `Bearer ${token}`) : r;
      };
      it.each([
        [UserRole.SHOP_OWNER, "owner"],
        [UserRole.SHOP_MANAGER, "manager"],
        [UserRole.SHOP_COUNTER, "counter"],
      ] as const)("shop A %s -> its own shop", async (role, key) => {
        expect((await get(staffTokens.A![role]!, shopA.id)).status).toBe(expected[key]);
      });
      it.each(SHOP_STAFF_ROLES)("shop B %s -> shop A is always 403", async (role) => {
        expect((await get(staffTokens.B![role]!, shopA.id)).status).toBe(403);
      });
      it("admin (no shop membership) and customer -> 403; anonymous -> 401", async () => {
        expect((await get(adminToken, shopA.id)).status).toBe(403);
        expect((await get(customerOwnerToken, shopA.id)).status).toBe(403);
        expect((await get(null, shopA.id)).status).toBe(401);
      });
    });

    it("admin dashboard: ADMIN 200; every shop role and customer 403; anonymous 401", async () => {
      const get = (token: string | null) => {
        const r = request(app.getHttpServer()).get("/v1/admin/dashboard");
        return token ? r.set("Authorization", `Bearer ${token}`) : r;
      };
      expect((await get(adminToken)).status).toBe(200);
      for (const label of ["A", "B"] as const) {
        for (const role of SHOP_STAFF_ROLES) {
          expect((await get(staffTokens[label]![role]!)).status).toBe(403);
        }
      }
      expect((await get(customerOwnerToken)).status).toBe(403);
      expect((await get(null)).status).toBe(401);
    });
  });
});
