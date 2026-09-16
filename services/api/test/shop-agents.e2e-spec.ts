import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { AgentPairingCodeService } from "../src/shop-agents/agent-pairing-code.service.js";

describe("Pairing code issuance & redemption (9.2, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let pairingCodeService: AgentPairingCodeService;

  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let counterAToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    pairingCodeService = app.get(AgentPairingCodeService);

    shopA = await prisma.shop.create({
      data: {
        name: `Shop Agents E2E Shop A ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Shop Agents E2E Shop B ${randomUUID()}`,
        address: "2",
        status: ShopStatus.OPEN,
      },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Shop Agents E2E Counter",
        email: `shop-agents-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterAtShopA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterAToken = tokenService.issueAccessToken(counterAtShopA);
  });

  afterAll(async () => {
    await prisma.agentPairingCode.deleteMany({ where: { shopId: { in: [shopA.id, shopB.id] } } });
    await prisma.shopStaff.deleteMany({ where: { userId: counterAtShopA.id } });
    await prisma.user.deleteMany({ where: { id: counterAtShopA.id } });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("issues an 8-character code with a ~10-minute expiry, hashed at rest", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/agents/pairing-code")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);

    const expiresAt = new Date(res.body.expiresAt).getTime();
    const expectedMs = 10 * 60 * 1000;
    expect(expiresAt - Date.now()).toBeGreaterThan(expectedMs - 5000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(expectedMs + 5000);

    const stored = await prisma.agentPairingCode.findFirst({
      where: { shopId: shopA.id },
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.codeHash).not.toBe(res.body.code);
    expect(stored?.codeHash.length).toBe(64); // sha256 hex
  });

  it("returns 403 for a shopId the caller doesn't staff", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/agents/pairing-code")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopB.id });
    expect(res.status).toBe(403);
  });

  it("a code is single-use -- a second redemption is refused, not double-honored", async () => {
    const { code } = await pairingCodeService.issue(shopA.id, counterAtShopA.id);

    const first = await pairingCodeService.redeem(code);
    expect(first.shopId).toBe(shopA.id);

    await expect(pairingCodeService.redeem(code)).rejects.toMatchObject({
      errorCode: "PAIRING_CODE_CONSUMED",
    });
  });

  it("an expired code is refused, and an unknown code is refused", async () => {
    const { code } = await pairingCodeService.issue(shopA.id, counterAtShopA.id);
    await prisma.agentPairingCode.updateMany({
      where: { shopId: shopA.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(pairingCodeService.redeem(code)).rejects.toMatchObject({
      errorCode: "PAIRING_CODE_EXPIRED",
    });

    await expect(pairingCodeService.redeem("NOTAREAL")).rejects.toMatchObject({
      errorCode: "PAIRING_CODE_INVALID",
    });
  });

  it("two concurrent redemptions of the same code: exactly one wins", async () => {
    const { code } = await pairingCodeService.issue(shopA.id, counterAtShopA.id);

    const results = await Promise.allSettled([
      pairingCodeService.redeem(code),
      pairingCodeService.redeem(code),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
