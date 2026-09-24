import { randomUUID } from "node:crypto";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { TokenService } from "../../src/auth/token.service.js";
import { createPhase19Fixture } from "./phase19-fixture.js";

/** Phase 20 e2e scaffolding, layered on the Phase 19 fixture (shop A with an
 * owner, printers and orders). Adds: staff of every interesting role at shop A,
 * a second shop B with its own owner (the tenant-isolation counterpart), and
 * cleanup of everything inventory-related this suite created. Targeted deletes
 * only (by the ids/shops this fixture created), never bulk. */
export async function createInventoryFixture(
  label: string,
  opts: {
    multiItemEnabled?: boolean;
    documentPages?: number | null;
    autoFailoverEnabled?: boolean;
  } = {},
) {
  const base = await createPhase19Fixture(label, {
    multiItemEnabled: opts.multiItemEnabled ?? true,
    documentPages: opts.documentPages,
    autoFailoverEnabled: opts.autoFailoverEnabled,
  });
  const { prisma, app } = base;
  const tokens = app.get(TokenService);
  const extraUserIds: string[] = [];
  const extraShopIds: string[] = [];

  async function makeStaff(shopId: string, role: UserRole) {
    const user = await prisma.user.create({
      data: {
        role,
        name: `${label} ${role}`,
        email: `${label}-${role.toLowerCase()}-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    extraUserIds.push(user.id);
    await prisma.shopStaff.create({
      data: { shopId, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
    });
    return { user, token: tokens.issueAccessToken(user) };
  }

  const manager = await makeStaff(base.shop.id, UserRole.SHOP_MANAGER);
  const operator = await makeStaff(base.shop.id, UserRole.OPERATOR);
  const counter = await makeStaff(base.shop.id, UserRole.SHOP_COUNTER);

  const shopB = await prisma.shop.create({
    data: { name: `${label} shop B ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
  });
  extraShopIds.push(shopB.id);
  const ownerB = await makeStaff(shopB.id, UserRole.SHOP_OWNER);

  const allShopIds = (): string[] => [base.shop.id, ...extraShopIds];

  async function cleanup(): Promise<void> {
    const errors: unknown[] = [];
    const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        errors.push(new Error(`inventory cleanup step "${name}" failed: ${String(error)}`));
      }
    };
    const shopIds = allShopIds();
    let resourceIds: string[] = [];
    await step("collect ids", async () => {
      const items = await prisma.inventoryItem.findMany({
        where: { shopId: { in: shopIds } },
        select: { id: true },
      });
      resourceIds = [...items.map((i) => i.id), ...shopIds];
    });
    await step("audit_logs", () =>
      prisma.auditLog.deleteMany({
        where: { OR: [{ resourceId: { in: resourceIds } }, { actorId: { in: extraUserIds } }] },
      }),
    );
    // Shop delete cascades items, movements, alerts, suppliers, purchase orders.
    await step("shop_staff", () =>
      prisma.shopStaff.deleteMany({ where: { userId: { in: extraUserIds } } }),
    );
    await step("extra shops", () =>
      prisma.shop.deleteMany({ where: { id: { in: extraShopIds } } }),
    );
    try {
      await base.cleanup();
    } catch (error) {
      errors.push(error);
    }
    // Base cleanup deletes shop A (cascading inventory), so extra users are safe to remove now.
    await step("extra users", () =>
      prisma.user.deleteMany({ where: { id: { in: extraUserIds } } }),
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "Inventory fixture cleanup had failures");
    }
  }

  return { ...base, cleanup, manager, operator, counter, shopB, ownerB, tokens };
}

export type InventoryFixture = Awaited<ReturnType<typeof createInventoryFixture>>;
