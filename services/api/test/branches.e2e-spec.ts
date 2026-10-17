import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** Branches live inside one business. Every shop always has at least its first branch: a
 * migration backfilled the existing ones and a trigger creates one for every new shop, so older
 * code that only inserts a shop keeps working. */
describe("Branches (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const shopIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("schema", () => {
    it("gives every new shop exactly one open branch named after it", async () => {
      const shop = await prisma.shop.create({
        data: {
          name: `Branch E2E Shop ${randomUUID()}`,
          address: "12 Main Street",
          phone: "0300 1234567",
          status: ShopStatus.CLOSED,
        },
      });
      shopIds.push(shop.id);

      const branches = await prisma.branch.findMany({ where: { shopId: shop.id } });
      expect(branches).toHaveLength(1);
      expect(branches[0]).toMatchObject({
        name: shop.name,
        address: "12 Main Street",
        phone: "0300 1234567",
        isOpen: true,
        archivedAt: null,
      });
    });

    it("backfilled a branch for shops that existed before branches", async () => {
      const withoutBranch = await prisma.shop.count({ where: { branches: { none: {} } } });
      expect(withoutBranch).toBe(0);
    });

    it("refuses a staff row that points at another shop's branch", async () => {
      const shopA = await prisma.shop.create({
        data: { name: `Branch E2E A ${randomUUID()}`, address: "1" },
      });
      const shopB = await prisma.shop.create({
        data: { name: `Branch E2E B ${randomUUID()}`, address: "2" },
      });
      shopIds.push(shopA.id, shopB.id);
      const branchOfB = await prisma.branch.findFirstOrThrow({ where: { shopId: shopB.id } });
      const user = await prisma.user.create({
        data: {
          role: UserRole.SHOP_COUNTER,
          name: "Branch E2E Counter",
          email: `branch-e2e-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(user.id);

      await expect(
        prisma.shopStaff.create({
          data: {
            shopId: shopA.id,
            userId: user.id,
            role: UserRole.SHOP_COUNTER,
            status: ShopStaffStatus.ACTIVE,
            branchId: branchOfB.id,
          },
        }),
      ).rejects.toThrow();
    });

    it("lets staff rows exist with no branch (meaning all branches)", async () => {
      const shop = await prisma.shop.create({
        data: { name: `Branch E2E C ${randomUUID()}`, address: "3" },
      });
      shopIds.push(shop.id);
      const user = await prisma.user.create({
        data: {
          role: UserRole.SHOP_COUNTER,
          name: "Branch E2E Roamer",
          email: `branch-e2e-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(user.id);
      const row = await prisma.shopStaff.create({
        data: {
          shopId: shop.id,
          userId: user.id,
          role: UserRole.SHOP_COUNTER,
          status: ShopStaffStatus.ACTIVE,
        },
      });
      expect(row.branchId).toBeNull();
    });
  });
});
