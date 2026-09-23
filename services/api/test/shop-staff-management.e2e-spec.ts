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

/** §54/16.4: add/remove/change-role, shop-scoped and permission-gated
 * (MANAGE_USERS -- SHOP_MANAGER/SHOP_OWNER only). Direct add-by-
 * existing-user-id, per shop-staff.service.ts's own documented scope
 * decision -- no invite-by-email flow in this sub-phase. */
describe("Shop staff management API (§54, 16.4, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  let ownerAtShopA: { id: string; role: UserRole };
  let ownerToken: string;
  let counterAtShopA: { id: string; role: UserRole };
  let counterToken: string;
  let ownerAtShopB: { id: string; role: UserRole };
  let ownerBToken: string;
  let managerAtShopA: { id: string; role: UserRole };
  let managerToken: string;

  const userIds: string[] = [];
  const shopIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `Staff Mgmt E2E Shop A ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Staff Mgmt E2E Shop B ${randomUUID()}`,
        address: "2",
        status: ShopStatus.OPEN,
      },
    });
    shopIds.push(shopA.id, shopB.id);

    ownerAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Staff Mgmt E2E Owner A",
        email: `staff-mgmt-e2e-owner-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(ownerAtShopA.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: ownerAtShopA.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    ownerToken = tokenService.issueAccessToken(ownerAtShopA);

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Staff Mgmt E2E Counter A",
        email: `staff-mgmt-e2e-counter-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(counterAtShopA.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterAtShopA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = tokenService.issueAccessToken(counterAtShopA);

    ownerAtShopB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Staff Mgmt E2E Owner B",
        email: `staff-mgmt-e2e-owner-b-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(ownerAtShopB.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shopB.id,
        userId: ownerAtShopB.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    ownerBToken = tokenService.issueAccessToken(ownerAtShopB);

    managerAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Staff Mgmt E2E Manager A",
        email: `staff-mgmt-e2e-manager-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(managerAtShopA.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: managerAtShopA.id,
        role: UserRole.SHOP_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    managerToken = tokenService.issueAccessToken(managerAtShopA);
  });

  afterAll(async () => {
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  it("SHOP_OWNER adds an existing user as staff with a chosen role", async () => {
    const newUser = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E New Hire",
        email: `staff-mgmt-e2e-new-hire-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(newUser.id);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ shopId: shopA.id, userId: newUser.id, role: "OPERATOR" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("OPERATOR");
    expect(res.body.status).toBe("ACTIVE");

    const stored = await prisma.shopStaff.findUnique({
      where: { shopId_userId: { shopId: shopA.id, userId: newUser.id } },
    });
    expect(stored?.role).toBe("OPERATOR");
  });

  it("re-adding an already-staffed user updates their role instead of erroring (idempotent upsert)", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ shopId: shopA.id, userId: counterAtShopA.id, role: "PRINTER_MANAGER" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("PRINTER_MANAGER");

    // Restore for later tests in this file that assume COUNTER.
    await prisma.shopStaff.update({
      where: { shopId_userId: { shopId: shopA.id, userId: counterAtShopA.id } },
      data: { role: UserRole.SHOP_COUNTER },
    });
  });

  it("add returns 403 for a SHOP_COUNTER (lacks MANAGE_USERS)", async () => {
    const newUser = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Blocked Hire",
        email: `staff-mgmt-e2e-blocked-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(newUser.id);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set("Authorization", `Bearer ${counterToken}`)
      .send({ shopId: shopA.id, userId: newUser.id, role: "SHOP_COUNTER" });
    expect(res.status).toBe(403);
  });

  it("add returns 403 for a shopId the caller doesn't own/manage", async () => {
    const newUser = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Cross Shop Hire",
        email: `staff-mgmt-e2e-cross-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(newUser.id);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ shopId: shopB.id, userId: newUser.id, role: "SHOP_COUNTER" });
    expect(res.status).toBe(403);
  });

  it("changes a staff member's role", async () => {
    const target = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Role Change Target",
        email: `staff-mgmt-e2e-role-change-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(target.id);
    const membership = await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: target.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/staff/${membership.id}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "SHOP_MANAGER" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("SHOP_MANAGER");
  });

  it("removes a staff member (soft delete -- status REMOVED, row not deleted)", async () => {
    const target = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Removal Target",
        email: `staff-mgmt-e2e-removal-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(target.id);
    const membership = await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: target.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/v1/shop/staff/${membership.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);

    const stored = await prisma.shopStaff.findUnique({ where: { id: membership.id } });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("REMOVED");
  });

  it("remove/change-role return 403 for a shopStaffId belonging to another shop", async () => {
    const target = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Shop B Target",
        email: `staff-mgmt-e2e-shopb-target-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(target.id);
    const membership = await prisma.shopStaff.create({
      data: {
        shopId: shopB.id,
        userId: target.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    const removeRes = await request(app.getHttpServer())
      .delete(`/v1/shop/staff/${membership.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(removeRes.status).toBe(403);

    const roleRes = await request(app.getHttpServer())
      .patch(`/v1/shop/staff/${membership.id}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "SHOP_MANAGER" });
    expect(roleRes.status).toBe(403);
  });

  it("refuses to remove a shop's last active SHOP_OWNER (409 CANNOT_REMOVE_LAST_OWNER)", async () => {
    const soleOwnerMembership = await prisma.shopStaff.findFirstOrThrow({
      where: { shopId: shopB.id, userId: ownerAtShopB.id },
    });

    const res = await request(app.getHttpServer())
      .delete(`/v1/shop/staff/${soleOwnerMembership.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("CANNOT_REMOVE_LAST_OWNER");

    const stillActive = await prisma.shopStaff.findUnique({
      where: { id: soleOwnerMembership.id },
    });
    expect(stillActive?.status).toBe("ACTIVE");
  });

  it("refuses to demote a shop's last active SHOP_OWNER away from SHOP_OWNER (409)", async () => {
    const soleOwnerMembership = await prisma.shopStaff.findFirstOrThrow({
      where: { shopId: shopB.id, userId: ownerAtShopB.id },
    });

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/staff/${soleOwnerMembership.id}/role`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ role: "SHOP_MANAGER" });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("CANNOT_REMOVE_LAST_OWNER");

    const stillOwner = await prisma.shopStaff.findUnique({ where: { id: soleOwnerMembership.id } });
    expect(stillOwner?.role).toBe("SHOP_OWNER");
  });

  it("allows removing an owner when another active owner remains at the same shop", async () => {
    const secondOwner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Second Owner",
        email: `staff-mgmt-e2e-second-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(secondOwner.id);
    const secondOwnerMembership = await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: secondOwner.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/v1/shop/staff/${secondOwnerMembership.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);
  });

  // Code review finding (16.6 review, critical): MANAGE_USERS alone let a
  // SHOP_MANAGER -- who deliberately lacks MANAGE_SETTINGS -- grant
  // themselves or anyone else SHOP_OWNER, bypassing the owner/manager
  // boundary entirely. assertCanGrantRole now requires the ACTOR to
  // already be an active SHOP_OWNER at this shop before either endpoint
  // will hand out SHOP_OWNER.
  it("add returns 403 when a SHOP_MANAGER (not an owner) tries to grant SHOP_OWNER", async () => {
    const target = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Escalation Target",
        email: `staff-mgmt-e2e-escalation-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(target.id);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ shopId: shopA.id, userId: target.id, role: "SHOP_OWNER" });
    expect(res.status).toBe(403);

    const stored = await prisma.shopStaff.findUnique({
      where: { shopId_userId: { shopId: shopA.id, userId: target.id } },
    });
    expect(stored).toBeNull();
  });

  it("add still succeeds for a real SHOP_OWNER granting SHOP_OWNER (the fix isn't a blanket ban)", async () => {
    const target = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Staff Mgmt E2E Legit New Owner",
        email: `staff-mgmt-e2e-legit-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(target.id);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ shopId: shopA.id, userId: target.id, role: "SHOP_OWNER" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("SHOP_OWNER");

    // Clean up back to a non-owner so it doesn't interfere with any
    // other test in this file relying on shopA's owner count.
    await prisma.shopStaff.update({
      where: { shopId_userId: { shopId: shopA.id, userId: target.id } },
      data: { role: UserRole.SHOP_COUNTER },
    });
  });

  it("changeRole returns 403 when a SHOP_MANAGER tries to promote someone to SHOP_OWNER", async () => {
    const res = await request(app.getHttpServer())
      .patch(
        `/v1/shop/staff/${(await prisma.shopStaff.findFirstOrThrow({ where: { shopId: shopA.id, userId: counterAtShopA.id } })).id}/role`,
      )
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ role: "SHOP_OWNER" });
    expect(res.status).toBe(403);

    const unchanged = await prisma.shopStaff.findFirstOrThrow({
      where: { shopId: shopA.id, userId: counterAtShopA.id },
    });
    expect(unchanged.role).toBe("SHOP_COUNTER");
  });

  // Code review finding (16.6 review, critical): assertNotLastOwner was a
  // plain count() followed by a separate update() with no lock, so two
  // concurrent removals of two different owners at the same shop could
  // both read "the other owner still exists" and both commit, leaving
  // zero owners. Fixed with a `SELECT ... FOR UPDATE` inside the same
  // transaction as the write. This test fires both removals genuinely
  // concurrently (Promise.all, not sequential awaits) against a shop
  // with exactly two active owners and asserts the invariant holds no
  // matter which one wins the race.
  it("concurrent removal of two different owners at the same shop never leaves zero owners", async () => {
    const concurrencyShop = await prisma.shop.create({
      data: {
        name: `Staff Mgmt E2E Concurrency Shop ${randomUUID()}`,
        address: "3",
        status: ShopStatus.OPEN,
      },
    });
    shopIds.push(concurrencyShop.id);

    const ownerOne = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Staff Mgmt E2E Concurrency Owner 1",
        email: `staff-mgmt-e2e-race-owner-1-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(ownerOne.id);
    const ownerOneMembership = await prisma.shopStaff.create({
      data: {
        shopId: concurrencyShop.id,
        userId: ownerOne.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const ownerOneToken = tokenService.issueAccessToken(ownerOne);

    const ownerTwo = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Staff Mgmt E2E Concurrency Owner 2",
        email: `staff-mgmt-e2e-race-owner-2-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(ownerTwo.id);
    const ownerTwoMembership = await prisma.shopStaff.create({
      data: {
        shopId: concurrencyShop.id,
        userId: ownerTwo.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const ownerTwoToken = tokenService.issueAccessToken(ownerTwo);

    const [resOne, resTwo] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/v1/shop/staff/${ownerOneMembership.id}`)
        .set("Authorization", `Bearer ${ownerOneToken}`),
      request(app.getHttpServer())
        .delete(`/v1/shop/staff/${ownerTwoMembership.id}`)
        .set("Authorization", `Bearer ${ownerTwoToken}`),
    ]);

    const statuses = [resOne.status, resTwo.status].sort();
    // Exactly one wins (204) and one is correctly refused (409) -- never
    // both 204s, which is the exact scenario that would leave zero owners.
    expect(statuses).toEqual([204, 409]);

    const remainingActiveOwners = await prisma.shopStaff.count({
      where: {
        shopId: concurrencyShop.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    expect(remainingActiveOwners).toBe(1);
  });
});
