import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { DocumentStatus, OrderStatus, PrintJobStatus } from "@prisma/client";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { branchIdOf } from "./helpers/branches.js";

/** 5.4's own Done-when: an exhaustive matrix over every (state, event)
 * pair. `EXPECTED` is an independently hand-written mirror of the
 * `TRANSITIONS` table inside order-state-machine.ts -- not imported
 * from it -- so a typo in the real table (a missing entry, a wrong
 * target) shows up as a matrix mismatch rather than the test silently
 * checking the implementation against itself. The §79 cancellation
 * scope and full-terminality of the terminal states are asserted
 * again, separately, below: the two places a wrong `EXPECTED` entry
 * would most plausibly slip through unnoticed.
 *
 * 18.2 deliberately excludes SYNC_JOBS from this fixed-target matrix --
 * its target is *computed* from a real print_jobs row set, not looked
 * up per (state, event), so a fixed EXPECTED table can't express it.
 * SYNC_JOBS gets its own dedicated describe block below instead. */
const EXPECTED: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  [OrderStatus.DRAFT]: {
    [OrderEvent.CONFIRM_UPLOAD]: OrderStatus.UPLOADED,
  },
  [OrderStatus.UPLOADED]: {
    [OrderEvent.REQUEST_PAYMENT]: OrderStatus.PAYMENT_PENDING,
    // 24.1: the worker's expiry sweep fires this only for QR orders.
    [OrderEvent.EXPIRE]: OrderStatus.EXPIRED,
  },
  [OrderStatus.PAYMENT_PENDING]: {
    [OrderEvent.CONFIRM_PAYMENT]: OrderStatus.PAID,
    [OrderEvent.FAIL_PAYMENT]: OrderStatus.PAYMENT_FAILED,
    [OrderEvent.CANCEL]: OrderStatus.CANCELLED,
    [OrderEvent.EXPIRE]: OrderStatus.EXPIRED,
  },
  [OrderStatus.PAID]: {
    [OrderEvent.ROUTE_TO_SHOP]: OrderStatus.WAITING_FOR_SHOP,
  },
  [OrderStatus.WAITING_FOR_SHOP]: {
    [OrderEvent.SHOP_ACCEPT]: OrderStatus.SHOP_ACCEPTED,
    [OrderEvent.SHOP_REJECT]: OrderStatus.SHOP_REJECTED,
    [OrderEvent.CANCEL]: OrderStatus.CANCELLED,
  },
  [OrderStatus.SHOP_ACCEPTED]: {
    [OrderEvent.QUEUE_PRINT]: OrderStatus.QUEUED_FOR_PRINT,
  },
  [OrderStatus.QUEUED_FOR_PRINT]: {},
  [OrderStatus.PRINTING]: {},
  [OrderStatus.PRINTED]: {
    [OrderEvent.MARK_READY]: OrderStatus.READY_FOR_COLLECTION,
  },
  [OrderStatus.READY_FOR_COLLECTION]: {
    [OrderEvent.COMPLETE]: OrderStatus.COMPLETED,
  },
  [OrderStatus.COMPLETED]: {},
  [OrderStatus.PAYMENT_FAILED]: {},
  [OrderStatus.SHOP_REJECTED]: {},
  [OrderStatus.PRINT_FAILED]: {},
  [OrderStatus.PRINT_STATUS_UNKNOWN]: {},
  [OrderStatus.CANCELLED]: {},
  [OrderStatus.EXPIRED]: {},
  [OrderStatus.PREPARING]: {},
  [OrderStatus.ASSIGNED]: {},
  [OrderStatus.PAUSED]: {},
  [OrderStatus.QUALITY_CHECK]: {
    [OrderEvent.QC_PASS]: OrderStatus.READY_FOR_COLLECTION,
    [OrderEvent.QC_FAIL]: OrderStatus.PRINT_FAILED,
    [OrderEvent.QC_REPRINT]: OrderStatus.QUEUED_FOR_PRINT,
  },
};

// Every event EXCEPT SYNC_JOBS -- see the matrix's own comment above.
const FIXED_TARGET_EVENTS = Object.values(OrderEvent).filter(
  (event) => event !== OrderEvent.SYNC_JOBS,
);

describe("OrderStateMachine (5.4/18.2, e2e)", () => {
  let prisma: PrismaService;
  let stateMachine: OrderStateMachine;
  let customerId: string;
  let shopId: string;
  let documentId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    stateMachine = app.get(OrderStateMachine);

    const customer = await prisma.user.findUniqueOrThrow({
      where: { email: "customer@print-automated.dev" },
    });
    customerId = customer.id;
    const shop = await prisma.shop.findFirstOrThrow();
    shopId = shop.id;
    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/order-state-machine/${randomUUID()}`,
        filename: "matrix-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    // 7.3: some of the matrix's legal transitions (CONFIRM_PAYMENT,
    // SHOP_ACCEPT, ...) now create notifications rows referencing
    // these orders -- delete those first, or the FK blocks the order
    // delete below.
    await prisma.printJob.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.document.delete({ where: { id: documentId } });
  });

  async function createOrderIn(status: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-${randomUUID()}`,
        customerId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: status,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  it("every (state, event) pair for every FIXED-target event: legal moves succeed to the expected target, illegal ones throw a 409 and leave the row untouched", async () => {
    const states = Object.values(OrderStatus);

    const results = await Promise.all(
      states.flatMap((state) =>
        FIXED_TARGET_EVENTS.map(async (event) => {
          const orderId = await createOrderIn(state);
          const expected = EXPECTED[state][event];
          if (expected === undefined) {
            await expect(stateMachine.transition(orderId, event, { id: null })).rejects.toThrow(
              AppException,
            );
            const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
            expect(row.orderStatus).toBe(state);
          } else {
            const result = await stateMachine.transition(orderId, event, { id: null });
            expect(result).toBe(expected);
            const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
            expect(row.orderStatus).toBe(expected);
          }
          return { state, event };
        }),
      ),
    );

    expect(results).toHaveLength(states.length * FIXED_TARGET_EVENTS.length);
  }, 60_000);

  describe("SYNC_JOBS (18.2)", () => {
    it("is legal only from the nine DERIVED statuses -- illegal (409, no write) everywhere else", async () => {
      const derived = new Set<OrderStatus>([
        OrderStatus.QUEUED_FOR_PRINT,
        OrderStatus.PRINTING,
        OrderStatus.PRINTED,
        OrderStatus.PRINT_FAILED,
        OrderStatus.PRINT_STATUS_UNKNOWN,
        OrderStatus.PREPARING,
        OrderStatus.ASSIGNED,
        OrderStatus.PAUSED,
        OrderStatus.QUALITY_CHECK,
      ]);
      const notDerived = Object.values(OrderStatus).filter((s) => !derived.has(s));

      for (const state of notDerived) {
        const orderId = await createOrderIn(state);
        await expect(
          stateMachine.transition(orderId, OrderEvent.SYNC_JOBS, { id: null }),
        ).rejects.toThrow(AppException);
        const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
        expect(row.orderStatus).toBe(state);
      }
    });

    it("computes its target from the order's own non-superseded print_jobs (a single PRINTING job moves QUEUED_FOR_PRINT -> PRINTING)", async () => {
      const orderId = await createOrderIn(OrderStatus.QUEUED_FOR_PRINT);
      await prisma.printJob.create({
        data: {
          orderId,
          shopId,
          branchId: await branchIdOf(prisma, shopId),
          status: PrintJobStatus.PRINTING,
          idempotencyToken: randomUUID(),
        },
      });

      const result = await stateMachine.transition(orderId, OrderEvent.SYNC_JOBS, { id: null });
      expect(result).toBe(OrderStatus.PRINTING);
    });

    it("a target equal to the current status is a genuine no-op: no write, no audit row, no notification", async () => {
      const orderId = await createOrderIn(OrderStatus.PRINTING);
      await prisma.printJob.create({
        data: {
          orderId,
          shopId,
          branchId: await branchIdOf(prisma, shopId),
          status: PrintJobStatus.PRINTING,
          idempotencyToken: randomUUID(),
        },
      });

      const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const result = await stateMachine.transition(orderId, OrderEvent.SYNC_JOBS, { id: null });
      expect(result).toBe(OrderStatus.PRINTING);

      const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(after.updatedAt).toEqual(before.updatedAt);

      const audit = await prisma.auditLog.findFirst({
        where: { resourceType: "order", resourceId: orderId, action: "ORDER_SYNC_JOBS" },
      });
      expect(audit).toBeNull();
      const notifications = await prisma.notification.findMany({ where: { orderId } });
      expect(notifications).toHaveLength(0);
    });
  });

  it("§56: reaching COMPLETED sets completed_at exactly once; no other transition ever touches it", async () => {
    const orderId = await createOrderIn(OrderStatus.READY_FOR_COLLECTION);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(before.completedAt).toBeNull();

    await stateMachine.transition(orderId, OrderEvent.COMPLETE, { id: null });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.completedAt).not.toBeNull();

    const printingOrderId = await createOrderIn(OrderStatus.PRINTING);
    await prisma.printJob.create({
      data: {
        orderId: printingOrderId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        status: PrintJobStatus.PRINTED,
        idempotencyToken: randomUUID(),
      },
    });
    await stateMachine.transition(printingOrderId, OrderEvent.SYNC_JOBS, { id: null });
    const printed = await prisma.order.findUniqueOrThrow({ where: { id: printingOrderId } });
    expect(printed.completedAt).toBeNull();
  });

  it("§79: cancellation is legal only from PAYMENT_PENDING and WAITING_FOR_SHOP, never from PRINTING onward", async () => {
    const cancellable: OrderStatus[] = [OrderStatus.PAYMENT_PENDING, OrderStatus.WAITING_FOR_SHOP];
    const notCancellable = Object.values(OrderStatus).filter(
      (status) => !cancellable.includes(status),
    );

    for (const state of cancellable) {
      const orderId = await createOrderIn(state);
      const result = await stateMachine.transition(orderId, OrderEvent.CANCEL, { id: null });
      expect(result).toBe(OrderStatus.CANCELLED);
    }

    for (const state of notCancellable) {
      const orderId = await createOrderIn(state);
      await expect(
        stateMachine.transition(orderId, OrderEvent.CANCEL, { id: null }),
      ).rejects.toThrow(AppException);
    }
  });

  it("the five purely-terminal statuses accept no fixed-target event at all", async () => {
    const terminal = [
      OrderStatus.COMPLETED,
      OrderStatus.PAYMENT_FAILED,
      OrderStatus.SHOP_REJECTED,
      OrderStatus.CANCELLED,
      OrderStatus.EXPIRED,
    ];

    for (const state of terminal) {
      const orderId = await createOrderIn(state);
      for (const event of FIXED_TARGET_EVENTS) {
        await expect(stateMachine.transition(orderId, event, { id: null })).rejects.toThrow(
          AppException,
        );
      }
    }
  });

  it("a legal transition writes an audit row recording the actor and the from/to status", async () => {
    const orderId = await createOrderIn(OrderStatus.PAYMENT_PENDING);
    const actorId = customerId;

    await stateMachine.transition(orderId, OrderEvent.CONFIRM_PAYMENT, { id: actorId });

    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_CONFIRM_PAYMENT" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(actorId);
    expect(audit?.metadata).toMatchObject({
      from: OrderStatus.PAYMENT_PENDING,
      to: OrderStatus.PAID,
    });
  });

  it("a transition's side effect runs inside the same transaction as the status write", async () => {
    const orderId = await createOrderIn(OrderStatus.SHOP_ACCEPTED);
    let sideEffectRanWithStatus: OrderStatus | undefined;

    await stateMachine.transition(
      orderId,
      OrderEvent.QUEUE_PRINT,
      { id: null },
      {
        sideEffect: async (tx, next) => {
          sideEffectRanWithStatus = next;
          // Reads its own write through the same transaction handle --
          // proving this really executed before commit, not after.
          const row = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          expect(row.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
        },
      },
    );

    expect(sideEffectRanWithStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
  });

  it("a nonexistent order id is a 404, not a 409", async () => {
    await expect(
      stateMachine.transition(randomUUID(), OrderEvent.CANCEL, { id: null }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
