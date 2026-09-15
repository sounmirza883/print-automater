import {
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
  ShopStatus,
  ShopStaffStatus,
} from "@prisma/client";
import { hash } from "argon2";
import type { PrinterCapabilities } from "@print-automated/types";

const prisma = new PrismaClient();

// Fixed dev-only password for every seeded account. Never used outside
// local/dev seeding; production accounts always go through the real
// registration flow (1.5).
const DEV_PASSWORD = "DevPassword123!";

interface SeedUser {
  role: UserRole;
  name: string;
  email: string;
  phone: string;
}

/** Idempotent by email (users.email is @unique in the schema): re-running
 * the seed updates the existing row instead of creating a duplicate. */
async function upsertUser(passwordHash: string, params: SeedUser) {
  return prisma.user.upsert({
    where: { email: params.email },
    update: {
      role: params.role,
      name: params.name,
      phone: params.phone,
      status: UserStatus.ACTIVE,
    },
    create: {
      role: params.role,
      name: params.name,
      email: params.email,
      phone: params.phone,
      passwordHash,
      status: UserStatus.ACTIVE,
    },
  });
}

/** shops.name has no unique constraint (two real shops could share a
 * display name), so idempotency here is application-level: find by name
 * first, create only if absent. */
async function upsertShopByName(params: {
  name: string;
  address: string;
  phone: string;
  status: ShopStatus;
  capabilities: PrinterCapabilities;
}) {
  const existing = await prisma.shop.findFirst({ where: { name: params.name } });
  const data = {
    address: params.address,
    phone: params.phone,
    status: params.status,
    // PrinterCapabilities (packages/types) has no index signature, so
    // it isn't structurally an InputJsonObject even though every field
    // on it is plain JSON -- this cast is the standard, narrow way
    // Prisma itself documents for a typed value going into a Json column.
    capabilities: params.capabilities as unknown as Prisma.InputJsonValue,
  };
  if (existing) {
    return prisma.shop.update({ where: { id: existing.id }, data });
  }
  return prisma.shop.create({ data: { name: params.name, ...data } });
}

/** 4.2's "versioned, not updated in place" rule applies here too: a
 * re-run with the same `version` for a shop is a no-op (upsert against
 * the shopId+version unique constraint), never a silent overwrite of
 * what an earlier version meant. */
async function upsertPricingRule(params: {
  shopId: string;
  version: number;
  currency: string;
  pricePerPageMinor: number;
  colorSurchargePerPageMinor: number;
  otherCharges: Array<{ label: string; amountMinor: number }>;
  minimumChargeMinor: number;
}) {
  return prisma.pricingRule.upsert({
    where: { shopId_version: { shopId: params.shopId, version: params.version } },
    update: {
      currency: params.currency,
      pricePerPageMinor: params.pricePerPageMinor,
      colorSurchargePerPageMinor: params.colorSurchargePerPageMinor,
      otherCharges: params.otherCharges,
      minimumChargeMinor: params.minimumChargeMinor,
    },
    create: params,
  });
}

async function upsertShopStaff(params: { shopId: string; userId: string; role: UserRole }) {
  return prisma.shopStaff.upsert({
    where: { shopId_userId: { shopId: params.shopId, userId: params.userId } },
    update: { role: params.role, status: ShopStaffStatus.ACTIVE },
    create: { ...params, status: ShopStaffStatus.ACTIVE },
  });
}

async function main(): Promise<void> {
  const passwordHash = await hash(DEV_PASSWORD);

  const admin = await upsertUser(passwordHash, {
    role: UserRole.ADMIN,
    name: "Platform Admin",
    email: "admin@print-automated.dev",
    phone: "+923000000001",
  });

  const customer = await upsertUser(passwordHash, {
    role: UserRole.CUSTOMER,
    name: "Test Customer",
    email: "customer@print-automated.dev",
    phone: "+923000000002",
  });

  // Two shops with deliberately different operational profiles (4.2):
  // Shop A is full-service (color + duplex, pricier per page); Shop B
  // is mono/simplex-only and cheaper -- 4.3's discovery filter and
  // 4.4's quote endpoint both need this contrast to have anything real
  // to prove against.
  const shopA = await upsertShopByName({
    name: "Downtown Print & Copy (full-service)",
    address: "12 Mall Road, Lahore",
    phone: "+924200000001",
    status: ShopStatus.OPEN,
    capabilities: { color: true, duplex: true, a4: true, a3: false },
  });

  const shopB = await upsertShopByName({
    name: "Campus Quick Print (basic)",
    address: "4 University Ave, Lahore",
    phone: "+924200000002",
    status: ShopStatus.OPEN,
    capabilities: { color: false, duplex: false, a4: true, a3: false },
  });

  // version 1 for both -- the seed has never "repriced" either shop yet.
  await upsertPricingRule({
    shopId: shopA.id,
    version: 1,
    currency: "PKR",
    pricePerPageMinor: 1000, // Rs 10.00/page -- full-service pricing
    colorSurchargePerPageMinor: 500, // +Rs 5.00/page for color
    otherCharges: [],
    minimumChargeMinor: 5000, // Rs 50.00 minimum order
  });
  await upsertPricingRule({
    shopId: shopB.id,
    version: 1,
    currency: "PKR",
    pricePerPageMinor: 600, // Rs 6.00/page -- basic, mono-only pricing
    colorSurchargePerPageMinor: 0, // shop has no color capability at all
    otherCharges: [],
    minimumChargeMinor: 2000, // Rs 20.00 minimum order
  });

  const shopAOwner = await upsertUser(passwordHash, {
    role: UserRole.SHOP_OWNER,
    name: "Shop A Owner",
    email: "owner-a@print-automated.dev",
    phone: "+923000000003",
  });
  const shopAManager = await upsertUser(passwordHash, {
    role: UserRole.SHOP_MANAGER,
    name: "Shop A Manager",
    email: "manager-a@print-automated.dev",
    phone: "+923000000004",
  });
  const shopACounter = await upsertUser(passwordHash, {
    role: UserRole.SHOP_COUNTER,
    name: "Shop A Counter Staff",
    email: "counter-a@print-automated.dev",
    phone: "+923000000005",
  });

  const shopBOwner = await upsertUser(passwordHash, {
    role: UserRole.SHOP_OWNER,
    name: "Shop B Owner",
    email: "owner-b@print-automated.dev",
    phone: "+923000000006",
  });
  const shopBCounter = await upsertUser(passwordHash, {
    role: UserRole.SHOP_COUNTER,
    name: "Shop B Counter Staff",
    email: "counter-b@print-automated.dev",
    phone: "+923000000007",
  });

  await upsertShopStaff({ shopId: shopA.id, userId: shopAOwner.id, role: UserRole.SHOP_OWNER });
  await upsertShopStaff({
    shopId: shopA.id,
    userId: shopAManager.id,
    role: UserRole.SHOP_MANAGER,
  });
  await upsertShopStaff({
    shopId: shopA.id,
    userId: shopACounter.id,
    role: UserRole.SHOP_COUNTER,
  });
  await upsertShopStaff({ shopId: shopB.id, userId: shopBOwner.id, role: UserRole.SHOP_OWNER });
  await upsertShopStaff({
    shopId: shopB.id,
    userId: shopBCounter.id,
    role: UserRole.SHOP_COUNTER,
  });

  console.log("Seed complete:", {
    admin: admin.email,
    customer: customer.email,
    shopA: shopA.name,
    shopB: shopB.name,
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
