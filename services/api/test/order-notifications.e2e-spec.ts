import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  DocumentStatus,
  type NotificationType,
  OrderStatus,
  PrintJobStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import {
  OrderEvent,
  OrderStateMachine,
  PrismaService,
  QUEUE_NAMES,
  type SendEmailJob,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { branchIdOf } from "./helpers/branches.js";

/** §78/7.3's own Done-when: every one of the seven domain events
 * produces exactly one notification per recipient, with no duplicates
 * on transition replay. Six of the seven (everything but
 * CONFIRM_PAYMENT) aren't reachable through any real HTTP endpoint yet
 * -- Phase 8 (shop actions) and Phase 9 (the printer agent) own those
 * -- so this drives `OrderStateMachine.transition()` directly, the
 * same "exercise the general mechanism before its specific real
 * callers exist" approach 5.3's own e2e test used for the idempotency
 * interceptor. Each future real call site inherits this behavior for
 * free, by construction, once it calls transition() with one of these
 * events -- nothing there needs its own notification logic. */
describe("Order event -> notification mapping (7.3, e2e)", () => {
  let stateMachine: OrderStateMachine;
  let prisma: PrismaService;
  let notificationsQueue: Queue<SendEmailJob>;
  let customerId: string;
  let customerEmail: string;
  let shopId: string;
  let documentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    stateMachine = app.get(OrderStateMachine);
    notificationsQueue = app.get(getQueueToken(QUEUE_NAMES.NOTIFICATIONS));

    customerEmail = `order-notifications-e2e-${randomUUID()}@print-automated.dev`;
    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Order Notifications E2E Customer",
        email: customerEmail,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Order Notifications E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/order-notifications/${randomUUID()}`,
        filename: "order-notifications-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId } });
    await prisma.notification.deleteMany({ where: { userId: customerId } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
  });

  async function createOrderIn(status: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-NOTIF-${randomUUID()}`,
        customerId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: status,
      },
    });
    return order.id;
  }

  // 18.2: START_PRINT/FAIL_PRINT/FINISH_PRINT no longer exist -- the
  // same three notification outcomes are now reached via SYNC_JOBS,
  // whose target is *computed* from a real print_jobs row rather than
  // fixed per event, so these three cases seed one before transitioning.
  const cases: Array<{
    from: OrderStatus;
    event: OrderEvent;
    type: NotificationType;
    seedJobStatus?: PrintJobStatus;
  }> = [
    {
      from: OrderStatus.PAYMENT_PENDING,
      event: OrderEvent.CONFIRM_PAYMENT,
      type: "PAYMENT_CONFIRMED",
    },
    { from: OrderStatus.WAITING_FOR_SHOP, event: OrderEvent.SHOP_ACCEPT, type: "ORDER_ACCEPTED" },
    {
      from: OrderStatus.QUEUED_FOR_PRINT,
      event: OrderEvent.SYNC_JOBS,
      type: "PRINT_STARTED",
      seedJobStatus: PrintJobStatus.PRINTING,
    },
    {
      from: OrderStatus.PRINTING,
      event: OrderEvent.SYNC_JOBS,
      type: "PRINT_FAILED",
      seedJobStatus: PrintJobStatus.FAILED,
    },
    {
      from: OrderStatus.PRINTING,
      event: OrderEvent.SYNC_JOBS,
      type: "PRINT_COMPLETED",
      seedJobStatus: PrintJobStatus.PRINTED,
    },
    { from: OrderStatus.PRINTED, event: OrderEvent.MARK_READY, type: "READY_FOR_COLLECTION" },
    { from: OrderStatus.READY_FOR_COLLECTION, event: OrderEvent.COMPLETE, type: "ORDER_COMPLETED" },
  ];

  it.each(cases)(
    "$event produces exactly one APP + one EMAIL notification of type $type, with no internal terminology, and enqueues the email",
    async ({ from, event, type, seedJobStatus }) => {
      const orderId = await createOrderIn(from);
      if (seedJobStatus) {
        await prisma.printJob.create({
          data: {
            orderId,
            shopId,
            branchId: await branchIdOf(prisma, shopId),
            status: seedJobStatus,
            idempotencyToken: randomUUID(),
          },
        });
      }

      await stateMachine.transition(orderId, event, { id: null });

      const notifications = await prisma.notification.findMany({ where: { orderId, type } });
      expect(notifications).toHaveLength(2);

      const app = notifications.find((n) => n.channel === "APP");
      const email = notifications.find((n) => n.channel === "EMAIL");
      expect(app?.sentAt).not.toBeNull();
      expect(email?.sentAt).toBeNull();

      const payload = email?.payload as { subject: string; text: string };
      // §7.4's own Done-when, enforced here at the source: no raw
      // enum/status name reaches the customer.
      for (const forbidden of Object.values(OrderStatus)) {
        expect(payload.text).not.toContain(forbidden);
      }
      expect(payload.text).not.toContain("undefined");

      // Filtered by this specific notification row's id, not a raw
      // queue-wide count -- other e2e files run concurrently against
      // this same shared Redis "notifications" queue and enqueue
      // their own jobs at the same time, which a before/after delta
      // can't tell apart from this test's own job.
      const jobs = await notificationsQueue.getJobs(["waiting", "completed"]);
      const matchingJobs = jobs.filter((job) => job.data.notificationId === email?.id);
      expect(matchingJobs).toHaveLength(1);
    },
  );

  it("a transition attempted twice for the same event never produces a second notification -- the illegal-transition refusal on replay IS the guarantee", async () => {
    const orderId = await createOrderIn(OrderStatus.PAYMENT_PENDING);

    await stateMachine.transition(orderId, OrderEvent.CONFIRM_PAYMENT, { id: null });
    await expect(
      stateMachine.transition(orderId, OrderEvent.CONFIRM_PAYMENT, { id: null }),
    ).rejects.toThrow();

    const notifications = await prisma.notification.findMany({
      where: { orderId, type: "PAYMENT_CONFIRMED" },
    });
    expect(notifications).toHaveLength(2); // one APP, one EMAIL -- not four.
  });

  it("two genuinely concurrent transitions for the same event on the same order still produce exactly one notification pair", async () => {
    const orderId = await createOrderIn(OrderStatus.PRINTED);

    const results = await Promise.allSettled([
      stateMachine.transition(orderId, OrderEvent.MARK_READY, { id: null }),
      stateMachine.transition(orderId, OrderEvent.MARK_READY, { id: null }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const notifications = await prisma.notification.findMany({
      where: { orderId, type: "READY_FOR_COLLECTION" },
    });
    expect(notifications).toHaveLength(2);
  });

  describe("fix wave 1: a QR order's customerId is the shop's SYSTEM account -- never emailed", () => {
    let systemUserId: string;
    let systemEmail: string;
    let systemDocumentId: string;

    beforeAll(async () => {
      // The shape PublicOrdersService provisions: an undeliverable address on a
      // reserved `.invalid` domain. Emailing it is a guaranteed hard bounce.
      systemEmail = `qr-orders+${randomUUID()}@system.print-automated.invalid`;
      const systemUser = await prisma.user.create({
        data: {
          role: UserRole.SYSTEM,
          name: "Order Notifications E2E QR System",
          email: systemEmail,
          passwordHash: "irrelevant",
        },
      });
      systemUserId = systemUser.id;
      const document = await prisma.document.create({
        data: {
          ownerUserId: systemUserId,
          storageKey: `test/order-notifications/${randomUUID()}`,
          filename: "qr-order-notifications-test.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          status: DocumentStatus.READY,
        },
      });
      systemDocumentId = document.id;
    });

    afterAll(async () => {
      await prisma.printJob.deleteMany({ where: { order: { customerId: systemUserId } } });
      await prisma.notification.deleteMany({ where: { userId: systemUserId } });
      await prisma.order.deleteMany({ where: { customerId: systemUserId } });
      await prisma.document.delete({ where: { id: systemDocumentId } });
      await prisma.user.delete({ where: { id: systemUserId } });
    });

    it.each(cases)(
      "$event on a QR order creates no notification row and enqueues no email",
      async ({ from, event, seedJobStatus }) => {
        const order = await prisma.order.create({
          data: {
            publicOrderNumber: `TEST-NOTIF-QR-${randomUUID()}`,
            customerId: systemUserId,
            shopId,
            branchId: await branchIdOf(prisma, shopId),
            documentId: systemDocumentId,
            printConfiguration: {},
            pricingSnapshot: {},
            orderStatus: from,
            creationSource: "QR",
          },
        });
        if (seedJobStatus) {
          await prisma.printJob.create({
            data: {
              orderId: order.id,
              shopId,
              branchId: await branchIdOf(prisma, shopId),
              status: seedJobStatus,
              idempotencyToken: randomUUID(),
            },
          });
        }

        await stateMachine.transition(order.id, event, { id: null });

        // The transition itself still happened (and was audited as usual).
        const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.orderStatus).not.toBe(from);
        // No EMAIL row (it would bounce) and no APP row (nobody ever signs in as it).
        expect(await prisma.notification.count({ where: { orderId: order.id } })).toBe(0);
        const jobs = await notificationsQueue.getJobs(["waiting", "completed", "delayed"]);
        expect(jobs.some((job) => job.data.to === systemEmail)).toBe(false);
      },
    );

    it("the required notices (rejection, print failure) are skipped for it too -- there is no inbox to require", async () => {
      const order = await prisma.order.create({
        data: {
          publicOrderNumber: `TEST-NOTIF-QR-${randomUUID()}`,
          customerId: systemUserId,
          shopId,
          branchId: await branchIdOf(prisma, shopId),
          documentId: systemDocumentId,
          printConfiguration: {},
          pricingSnapshot: {},
          orderStatus: OrderStatus.WAITING_FOR_SHOP,
          creationSource: "QR",
        },
      });
      await stateMachine.transition(order.id, OrderEvent.SHOP_REJECT, { id: null });
      expect(await prisma.notification.count({ where: { orderId: order.id } })).toBe(0);
    });

    it.each(["CUSTOMER_WEB", "COUNTER"] as const)(
      "the same transition on a real account's %s order (the control) still notifies by both channels",
      async (creationSource) => {
        const orderId = await createOrderIn(OrderStatus.PRINTED);
        await prisma.order.update({ where: { id: orderId }, data: { creationSource } });
        await stateMachine.transition(orderId, OrderEvent.MARK_READY, { id: null });
        const notifications = await prisma.notification.findMany({ where: { orderId } });
        expect(notifications.map((n) => n.channel).sort()).toEqual(["APP", "EMAIL"]);
        const email = notifications.find((n) => n.channel === "EMAIL")!;
        const jobs = await notificationsQueue.getJobs(["waiting", "completed", "delayed"]);
        const job = jobs.find((j) => j.data.notificationId === email.id);
        expect(job?.data.to).toBe(customerEmail);
      },
    );
  });

  it("events with no §78 mapping (REQUEST_PAYMENT, CANCEL, ...) produce no notification at all", async () => {
    const orderId = await createOrderIn(OrderStatus.UPLOADED);
    await stateMachine.transition(orderId, OrderEvent.REQUEST_PAYMENT, { id: null });

    const notifications = await prisma.notification.findMany({ where: { orderId } });
    expect(notifications).toHaveLength(0);
  });
});
