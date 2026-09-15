import { PrismaClient, UserRole, UserStatus, ShopStatus, ShopStaffStatus } from "@prisma/client";
import { hash } from "argon2";

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
}) {
  const existing = await prisma.shop.findFirst({ where: { name: params.name } });
  if (existing) {
    return prisma.shop.update({
      where: { id: existing.id },
      data: { address: params.address, phone: params.phone, status: params.status },
    });
  }
  return prisma.shop.create({ data: params });
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

  // Two shops with deliberately different operational profiles. Their
  // print CAPABILITIES (color/duplex/paper) don't exist as a schema
  // column yet -- that lands in 4.2, which also extends this seed with
  // per-shop pricing and capability contrast. For now they're
  // distinguished by name/staffing so later phases have two real,
  // differently-staffed shops to test against.
  const shopA = await upsertShopByName({
    name: "Downtown Print & Copy (full-service)",
    address: "12 Mall Road, Lahore",
    phone: "+924200000001",
    status: ShopStatus.OPEN,
  });

  const shopB = await upsertShopByName({
    name: "Campus Quick Print (basic)",
    address: "4 University Ave, Lahore",
    phone: "+924200000002",
    status: ShopStatus.OPEN,
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
