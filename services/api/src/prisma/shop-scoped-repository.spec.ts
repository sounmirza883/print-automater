import { randomUUID } from "node:crypto";
import { UserRole, ShopStaffStatus } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { ShopScopedRepository } from "./shop-scoped-repository.js";

// Exercised against the real shop_staff table -- it's a genuine
// shop-owned resource already in the schema, no fake table needed.
describe("ShopScopedRepository (integration)", () => {
  let prisma: PrismaService;
  let shopA: { id: string };
  let shopB: { id: string };
  let userInShopA: { id: string };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    shopA = await prisma.shop.create({
      data: { name: `Repo Test Shop A ${randomUUID()}`, address: "1" },
    });
    shopB = await prisma.shop.create({
      data: { name: `Repo Test Shop B ${randomUUID()}`, address: "2" },
    });
    userInShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Repo Test Staff",
        email: `repo-test-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: userInShopA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userInShopA.id } }); // cascades shop_staff
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await prisma.$disconnect();
  });

  it("findFirst only returns rows scoped to the given shopId, even with an identical userId", async () => {
    const repo = new ShopScopedRepository(prisma.shopStaff);

    const foundInA = await repo.findFirst(shopA.id, { userId: userInShopA.id });
    expect(foundInA?.shopId).toBe(shopA.id);

    const foundInB = await repo.findFirst(shopB.id, { userId: userInShopA.id });
    expect(foundInB).toBeNull(); // same user, wrong shop -- must not leak across the boundary
  });

  it("findMany scopes results to the given shopId", async () => {
    const repo = new ShopScopedRepository(prisma.shopStaff);

    const rowsInA = await repo.findMany(shopA.id);
    expect(rowsInA.every((row) => row.shopId === shopA.id)).toBe(true);
    expect(rowsInA.some((row) => row.userId === userInShopA.id)).toBe(true);

    const rowsInB = await repo.findMany(shopB.id);
    expect(rowsInB.every((row) => row.shopId === shopB.id)).toBe(true);
  });
});
