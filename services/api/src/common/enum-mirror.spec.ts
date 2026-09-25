import {
  InventoryAlertStatus as PrismaInventoryAlertStatus,
  SupplierStatus as PrismaSupplierStatus,
  PurchaseOrderStatus as PrismaPurchaseOrderStatus,
  PurchaseOrderPaymentStatus as PrismaPurchaseOrderPaymentStatus,
  InventoryMovementType as PrismaInventoryMovementType,
  OrderStatus as PrismaOrderStatus,
  PaymentStatus as PrismaPaymentStatus,
  PrintJobStatus as PrismaPrintJobStatus,
  PrinterStatus as PrismaPrinterStatus,
  ShopStatus as PrismaShopStatus,
  UserRole as PrismaUserRole,
} from "@prisma/client";
import {
  InventoryAlertStatus,
  SupplierStatus,
  PurchaseOrderStatus,
  PurchaseOrderPaymentStatus,
  InventoryMovementType,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  PrinterStatus,
  ShopStatus,
  UserRole,
} from "@print-automated/types";

/** `packages/types` hand-mirrors the Prisma enums that cross the API
 * boundary, because client apps (customer-web, shop-mobile) cannot
 * import `@prisma/client`. Nothing ties the two together, so a value
 * added to a Prisma enum silently never reaches the clients: 18.2 added
 * four OrderStatus values (PREPARING, ASSIGNED, PAUSED, QUALITY_CHECK)
 * to Prisma and the mirror was never updated, so the API could emit
 * statuses the shared types -- and every client lookup table keyed on
 * them -- did not know (found in the Phase 18 review). This test fails
 * the moment any mirrored enum drifts, in either direction. */
const MIRRORS: Array<[string, Record<string, string>, Record<string, string>]> = [
  ["OrderStatus", PrismaOrderStatus, OrderStatus],
  ["PaymentStatus", PrismaPaymentStatus, PaymentStatus],
  ["PrintJobStatus", PrismaPrintJobStatus, PrintJobStatus],
  ["PrinterStatus", PrismaPrinterStatus, PrinterStatus],
  ["ShopStatus", PrismaShopStatus, ShopStatus],
  ["UserRole", PrismaUserRole, UserRole],
  ["InventoryMovementType", PrismaInventoryMovementType, InventoryMovementType],
  ["InventoryAlertStatus", PrismaInventoryAlertStatus, InventoryAlertStatus],
  ["SupplierStatus", PrismaSupplierStatus, SupplierStatus],
  ["PurchaseOrderStatus", PrismaPurchaseOrderStatus, PurchaseOrderStatus],
  ["PurchaseOrderPaymentStatus", PrismaPurchaseOrderPaymentStatus, PurchaseOrderPaymentStatus],
];

describe("packages/types enums mirror the Prisma enums exactly", () => {
  it.each(MIRRORS)("%s: same set of values on both sides", (_name, prismaEnum, typesEnum) => {
    const prismaValues = Object.values(prismaEnum).sort();
    const typesValues = Object.values(typesEnum).sort();
    const missingFromTypes = prismaValues.filter((v) => !typesValues.includes(v));
    const missingFromPrisma = typesValues.filter((v) => !prismaValues.includes(v));
    expect({ missingFromTypes, missingFromPrisma }).toEqual({
      missingFromTypes: [],
      missingFromPrisma: [],
    });
  });
});
