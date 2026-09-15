import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  UseGuards,
  VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { UserRole, ShopStaffStatus } from "@prisma/client";
import { AppModule } from "../src/app.module.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard.js";
import { RolesGuard } from "../src/auth/roles.guard.js";
import { ShopScopeGuard } from "../src/auth/shop-scope.guard.js";
import { Roles } from "../src/auth/roles.decorator.js";
import { ShopScoped } from "../src/auth/shop-scoped.decorator.js";
import type { ShopResourceResolver } from "../src/auth/shop-scope.interfaces.js";

// The "resource" under test IS the shop itself -- no shop-owned sub-table
// (orders, printers) exists until later phases, and a shop is a
// perfectly real, already-existing shop-scoped thing. Every future
// resolver (OrderShopResolver, PrinterShopResolver, ...) looks the same
// shape, just resolving through a different table.
@Injectable()
class ShopSelfResolver implements ShopResourceResolver {
  resolveShopId(resourceId: string): Promise<string | null> {
    return Promise.resolve(resourceId);
  }
}

@Controller("shop-scope-test")
class ShopScopeTestController {
  @Get(":shopId")
  @UseGuards(JwtAuthGuard, RolesGuard, ShopScopeGuard)
  @Roles(UserRole.SHOP_COUNTER)
  @ShopScoped("shopId", ShopSelfResolver)
  probe(@Param("shopId") shopId: string): { ok: true; shopId: string } {
    return { ok: true, shopId };
  }
}

// Mirrors exactly how a real feature module (future OrdersModule,
// PrintersModule) will consume the guards: import AuthModule directly
// rather than expect AppModule to re-export it. Nest module exports
// aren't transitive -- a controller declared straight on the root
// testing module can't reach AuthModule's exports just because AppModule
// happens to import AuthModule too.
@Module({
  imports: [AuthModule],
  controllers: [ShopScopeTestController],
  providers: [ShopSelfResolver],
})
class ShopScopeTestModule {}

describe("Authorization guard stack (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let plainCustomer: { id: string; role: UserRole };
  let counterAccessToken: string;
  let customerAccessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ShopScopeTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: { name: `Guard Test Shop A ${randomUUID()}`, address: "1" },
    });
    shopB = await prisma.shop.create({
      data: { name: `Guard Test Shop B ${randomUUID()}`, address: "2" },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Guard Test Counter A",
        email: `guard-counter-a-${randomUUID()}@print-automated.dev`,
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

    plainCustomer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Guard Test Customer",
        email: `guard-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });

    counterAccessToken = tokenService.issueAccessToken(counterAtShopA);
    customerAccessToken = tokenService.issueAccessToken(plainCustomer);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [counterAtShopA.id, plainCustomer.id] } } });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("allows shop A staff to access shop A's own resource", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop-scope-test/${shopA.id}`)
      .set("Authorization", `Bearer ${counterAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, shopId: shopA.id });
  });

  it("returns 403 when shop A staff request a shop B resource", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop-scope-test/${shopB.id}`)
      .set("Authorization", `Bearer ${counterAccessToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for a role that doesn't satisfy @Roles(SHOP_COUNTER), even for their own shop", async () => {
    // plainCustomer has no shop_staff row at all -- RolesGuard rejects
    // them before ShopScopeGuard would even get a chance to run.
    const res = await request(app.getHttpServer())
      .get(`/v1/shop-scope-test/${shopA.id}`)
      .set("Authorization", `Bearer ${customerAccessToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 401 with no bearer token at all", async () => {
    const res = await request(app.getHttpServer()).get(`/v1/shop-scope-test/${shopA.id}`);
    expect(res.status).toBe(401);
  });
});
