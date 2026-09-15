import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { DocumentStatus, OrderStatus } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { AppException } from "../src/common/errors/app-exception.js";
import { OrderEvent, OrderStateMachine } from "../src/orders/order-state-machine.js";

/** 5.4's own Done-when: an exhaustive matrix over every (state, event)
 * pair. `EXPECTED` is an independently hand-written mirror of the
 * `TRANSITIONS` table inside order-state-machine.ts -- not imported
 * from it -- so a typo in the real table (a missing entry, a wrong
 * target) shows up as a matrix mismatch rather than the test silently
 * checking the implementation against itself. The §79 cancellation
 * scope and full-terminality of the six terminal states are asserted
 * again, separately, below: the two places a wrong `EXPECTED` entry
 * would most plausibly slip through unnoticed. */
const EXPECTED: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  [OrderStatus.DRAFT]: {
    [OrderEvent.CONFIRM_UPLOAD]: OrderStatus.UPLOADED,
  },
  [OrderStatus.UPLOADED]: {
    [OrderEvent.REQUEST_PAYMENT]: OrderStatus.PAYMENT_PENDING,
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
  [OrderStatus.QUEUED_FOR_PRINT]: {
    [OrderEvent.START_PRINT]: OrderStatus.PRINTING,
    [OrderEvent.FAIL_PRINT]: OrderStatus.PRINT_FAILED,
  },
  [OrderStatus.PRINTING]: {
    [OrderEvent.FINISH_PRINT]: OrderStatus.PRINTED,
    [OrderEvent.FAIL_PRINT]: OrderStatus.PRINT_FAILED,
    [OrderEvent.LOSE_PRINT_STATUS]: OrderStatus.PRINT_STATUS_UNKNOWN,
  },
  [OrderStatus.PRINTED]: {
    [OrderEvent.MARK_READY]: OrderStatus.READY_FOR_COLLECTION,
  },
  [OrderStatus.READY_FOR_COLLECTION]: {
    [OrderEvent.COMPLETE]: OrderStatus.COMPLETED,
  },
  [OrderStatus.COMPLETED]: {},
  [OrderStatus.PAYMENT_FAILED]: {},
  [OrderStatus.SHOP_REJECTED]: {},
  [OrderStatus.PRINT_FAILED]: {
    [OrderEvent.RETRY_PRINT]: OrderStatus.QUEUED_FOR_PRINT,
  },
  [OrderStatus.PRINT_STATUS_UNKNOWN]: {
    [OrderEvent.RESOLVE_UNKNOWN_PRINTED]: OrderStatus.PRINTED,
    [OrderEvent.RESOLVE_UNKNOWN_RETRY]: OrderStatus.QUEUED_FOR_PRINT,
    [OrderEvent.RESOLVE_UNKNOWN_FAILED]: OrderStatus.PRINT_FAILED,
  },
  [OrderStatus.CANCELLED]: {},
  [OrderStatus.EXPIRED]: {},
};

describe("OrderStateMachine (5.4, e2e)", () => {
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
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.document.delete({ where: { id: documentId } });
  });

  async function createOrderIn(status: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: status,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  it("every (state, event) pair: legal moves succeed to the expected target, illegal ones throw a 409 and leave the row untouched", async () => {
    const states = Object.values(OrderStatus);
    const events = Object.values(OrderEvent);

    const results = await Promise.all(
      states.flatMap((state) =>
        events.map(async (event) => {
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

    // The matrix itself actually ran every cell -- 17 states x 20
    // events -- not a subset that happened to pass.
    expect(results).toHaveLength(states.length * events.length);
  }, 60_000);

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

  it("the six terminal states accept no event at all", async () => {
    const terminal = [
      OrderStatus.COMPLETED,
      OrderStatus.PAYMENT_FAILED,
      OrderStatus.SHOP_REJECTED,
      OrderStatus.CANCELLED,
      OrderStatus.EXPIRED,
    ];

    for (const state of terminal) {
      const orderId = await createOrderIn(state);
      for (const event of Object.values(OrderEvent)) {
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
