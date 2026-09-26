import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  PageLimitPeriod,
  PrinterRuleAction,
  PrinterStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService, periodStart } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** 23.14: printer detail, and who may READ the printer list/detail (VIEW_PRINTERS, as data)
 * while MANAGE_PRINTERS stays write-only. */
describe("Printer detail and read access (23.14, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  let shopA: { id: string };
  let shopB: { id: string };
  let printerId: string;
  let ruleId: string;
  const userIds: string[] = [];
  const shopIds: string[] = [];

  const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });
  const ROLES: Array<[string, UserRole]> = [
    ["owner", UserRole.SHOP_OWNER],
    ["manager", UserRole.SHOP_MANAGER],
    ["counter", UserRole.SHOP_COUNTER],
    ["operator", UserRole.OPERATOR],
    ["printerManager", UserRole.PRINTER_MANAGER],
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: { name: `Printer Detail A ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopB = await prisma.shop.create({
      data: { name: `Printer Detail B ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
    });
    shopIds.push(shopA.id, shopB.id);

    const staff: Array<[string, UserRole, { id: string }]> = [
      ...ROLES.map(([key, role]) => [key + "A", role, shopA] as [string, UserRole, { id: string }]),
      ["ownerB", UserRole.SHOP_OWNER, shopB],
    ];
    for (const [key, role, shop] of staff) {
      const user = await prisma.user.create({
        data: {
          role,
          name: `Printer Detail ${key}`,
          email: `printer-detail-${key}-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(user.id);
      await prisma.shopStaff.create({
        data: { shopId: shop.id, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
      });
      tokens[key] = tokenService.issueAccessToken(user);
    }

    const agent = await prisma.printerAgent.create({
      data: {
        deviceId: `printer-detail-${randomUUID()}`,
        shopId: shopA.id,
        publicKey: "x",
        lastSeenAt: new Date("2026-09-01T10:00:00Z"),
      },
    });
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        agentId: agent.id,
        name: `Detail Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
        model: "LaserJet 9000",
        location: "Back office",
        connectionType: "USB",
        supportedSizes: ["A4", "A3"],
        supportedPaperTypes: ["PLAIN"],
        maxJobPages: 200,
        maintenanceStatus: "toner due",
        capabilities: { color: true, duplex: true, a4: true, a3: false },
        lastStatusAt: new Date("2026-09-02T10:00:00Z"),
        pageLimit: 100,
        pageLimitEnabled: true,
        pageLimitPeriod: PageLimitPeriod.MONTHLY,
      },
    });
    printerId = printer.id;
    await prisma.printerPageUsage.create({
      data: {
        printerId,
        periodStart: periodStart("MONTHLY", new Date()),
        pagesUsed: 30,
      },
    });
    const rule = await prisma.printerAutomationRule.create({
      data: {
        shopId: shopA.id,
        position: 0,
        name: "Prefer the detail printer",
        action: PrinterRuleAction.PREFER,
        printerIds: [printerId],
      },
    });
    ruleId = rule.id;
    // A rule that does not reference this printer must not be listed.
    await prisma.printerAutomationRule.create({
      data: {
        shopId: shopA.id,
        position: 1,
        name: "Unrelated",
        action: PrinterRuleAction.AVOID,
        printerIds: [randomUUID()],
      },
    });
  });

  afterAll(async () => {
    await prisma.printerAutomationRule.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.printerPageUsage.deleteMany({ where: { printerId } });
    await prisma.printer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.printerAgent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  it("GET /shop/printers/:id returns capabilities, page limit usage, last seen and referencing rules", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/printers/${printerId}`)
      .set(auth("ownerA"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: printerId,
      shopId: shopA.id,
      status: "ONLINE",
      model: "LaserJet 9000",
      location: "Back office",
      connectionType: "USB",
      supportedSizes: ["A4", "A3"],
      supportedPaperTypes: ["PLAIN"],
      maxJobPages: 200,
      maintenanceStatus: "toner due",
      capabilities: { color: true, duplex: true, a4: true, a3: false },
      lastStatusAt: "2026-09-02T10:00:00.000Z",
      lastSeenAt: "2026-09-01T10:00:00.000Z",
      pageLimit: 100,
      pageLimitEnabled: true,
      pageLimitPeriod: "MONTHLY",
      pagesUsedInPeriod: 30,
      remainingAllowance: 70,
    });
    expect(res.body.pageLimitPeriodStart).toBe(periodStart("MONTHLY", new Date()).toISOString());
    expect(res.body.rules).toEqual([
      {
        id: ruleId,
        name: "Prefer the detail printer",
        action: "PREFER",
        enabled: true,
        position: 0,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("publicKey");
  });

  it.each(ROLES)(
    "%s at business A can read the printer list and detail (VIEW_PRINTERS)",
    async (key) => {
      const list = await request(app.getHttpServer())
        .get("/v1/shop/printers")
        .query({ shopId: shopA.id, limit: 100 })
        .set(auth(key + "A"));
      expect(list.status).toBe(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).toContain(printerId);
      const detail = await request(app.getHttpServer())
        .get(`/v1/shop/printers/${printerId}`)
        .set(auth(key + "A"));
      expect(detail.status).toBe(200);
    },
  );

  it("the legacy unpaged list still returns a bare array (existing clients)", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/shop/printers")
      .query({ shopId: shopA.id })
      .set(auth("counterA"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("MANAGE_PRINTERS stays write-only: operator and counter cannot write; printer manager can", async () => {
    for (const key of ["operatorA", "counterA"]) {
      const patch = await request(app.getHttpServer())
        .patch(`/v1/shop/printers/${printerId}`)
        .set(auth(key))
        .send({ name: "renamed" });
      expect(patch.status).toBe(403);
      const del = await request(app.getHttpServer())
        .delete(`/v1/shop/printers/${printerId}`)
        .set(auth(key));
      expect(del.status).toBe(403);
      const post = await request(app.getHttpServer())
        .post("/v1/shop/printers")
        .set(auth(key))
        .send({ shopId: shopA.id, name: "x" });
      expect(post.status).toBe(403);
    }
    const ok = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printerId}`)
      .set(auth("printerManagerA"))
      .send({ pageLimit: 100 });
    expect(ok.status).toBe(200);
  });

  it("business B cannot read business A's printer list or detail; unknown id and anonymous are refused", async () => {
    const detail = await request(app.getHttpServer())
      .get(`/v1/shop/printers/${printerId}`)
      .set(auth("ownerB"));
    expect(detail.status).toBe(403);
    const list = await request(app.getHttpServer())
      .get("/v1/shop/printers")
      .query({ shopId: shopA.id })
      .set(auth("ownerB"));
    expect(list.status).toBe(403);
    const unknown = await request(app.getHttpServer())
      .get(`/v1/shop/printers/${randomUUID()}`)
      .set(auth("ownerA"));
    expect(unknown.status).toBe(403);
    const anon = await request(app.getHttpServer()).get(`/v1/shop/printers/${printerId}`);
    expect(anon.status).toBe(401);
  });
});
