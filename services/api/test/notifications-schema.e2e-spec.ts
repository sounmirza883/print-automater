import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  DocumentStatus,
  NotificationChannel,
  NotificationType,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { branchIdOf } from "./helpers/branches.js";

/** §7.1's own Done-when: the migration applies, and there is an index
 * on (user_id, created_at) -- verified directly against pg_indexes,
 * the actual DDL outcome, not just that schema.prisma *says* @@index. */
describe("Notifications schema (7.1, e2e)", () => {
  let prisma: PrismaService;
  let userId: string;
  let shopId: string;
  let documentId: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Notifications Schema E2E",
        email: `notifications-schema-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userId = user.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Notifications Schema E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: userId,
        storageKey: `documents/${randomUUID()}`,
        filename: "notifications-schema-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
        checksum: "irrelevant-for-this-test",
      },
    });
    documentId = document.id;

    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `PA-NOTIFSCHEMA-${randomUUID()}`,
        customerId: userId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("applies: a notification can be created against a user and an order, with a JSONB payload and both timestamps nullable", async () => {
    const notification = await prisma.notification.create({
      data: {
        userId,
        orderId,
        type: NotificationType.PAYMENT_CONFIRMED,
        channel: NotificationChannel.APP,
        payload: { orderNumber: "PA-20260101-000001" },
      },
    });

    expect(notification.sentAt).toBeNull();
    expect(notification.readAt).toBeNull();
    expect(notification.payload).toEqual({ orderNumber: "PA-20260101-000001" });
  });

  it("notifications.(user_id, created_at) is indexed", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'
    `;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("notifications_user_id_created_at_idx");
  });
});
