import { randomUUID } from "node:crypto";
import { OrderStatus, PaymentStatus, Prisma, PrintJobStatus } from "@prisma/client";
import { jobPages } from "@print-automated/backend-shared";
import { JOB_PAGES_JOINS, JOB_TOTAL_PAGES } from "../src/analytics/job-pages-sql.js";
import { createPhase19Fixture, type Phase19Fixture } from "./helpers/phase19-fixture.js";

/** 23.2/23.5: the aggregate SQL page measure must equal the ONE TypeScript definition
 * (`jobPages`) that allocation, queue load and usage accrual use. */
type JobConfig = Parameters<typeof jobPages>[0];

describe("JOB_TOTAL_PAGES SQL == jobPages() (23.2, e2e)", () => {
  let fx: Phase19Fixture;
  const docIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    fx = await createPhase19Fixture("jobpages", { multiItemEnabled: false });
  });
  afterAll(async () => {
    if (fx) {
      await fx.prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
      await fx.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await fx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await fx.prisma.document.deleteMany({ where: { id: { in: docIds } } });
      await fx.cleanup();
    }
  });

  const cases: Array<{
    name: string;
    docPages: number | null;
    config: JobConfig;
    quantity: number | null; // order item quantity; null = legacy job with no item
  }> = [
    {
      name: "all pages, one copy",
      docPages: 5,
      config: { pages: { mode: "all" }, copies: 1 },
      quantity: 1,
    },
    {
      name: "all pages, item quantity wins over config copies",
      docPages: 5,
      config: { pages: { mode: "all" }, copies: 1 },
      quantity: 3,
    },
    {
      name: "range",
      docPages: 10,
      config: { pages: { mode: "range", from: 2, to: 4 }, copies: 2 },
      quantity: 2,
    },
    {
      name: "range beyond the document falls back to the whole document",
      docPages: 3,
      config: { pages: { mode: "range", from: 2, to: 9 }, copies: 1 },
      quantity: 1,
    },
    {
      name: "unknown document page count counts as 1",
      docPages: null,
      config: { pages: { mode: "all" }, copies: 1 },
      quantity: 1,
    },
    {
      name: "legacy job (no item) takes copies from the order configuration",
      docPages: 4,
      config: { pages: { mode: "all" }, copies: 5 },
      quantity: null,
    },
    {
      name: "single-page range",
      docPages: 9,
      config: { pages: { mode: "range", from: 9, to: 9 }, copies: 1 },
      quantity: 1,
    },
  ];

  it.each(cases)("$name", async ({ docPages, config, quantity }) => {
    const doc = await fx.prisma.document.create({
      data: {
        ownerUserId: fx.customer.id,
        storageKey: `test/jobpages/${randomUUID()}`,
        filename: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: docPages,
        status: "READY",
      },
    });
    docIds.push(doc.id);
    const fullConfig = {
      ...config,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    };
    const order = await fx.prisma.order.create({
      data: {
        publicOrderNumber: `TEST-jobpages-${randomUUID()}`,
        customerId: fx.customer.id,
        shopId: fx.shop.id,
        documentId: doc.id,
        printConfiguration: fullConfig as unknown as Prisma.InputJsonValue,
        pricingSnapshot: {},
        orderStatus: OrderStatus.QUEUED_FOR_PRINT,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    let itemId: string | undefined;
    if (quantity !== null) {
      const item = await fx.prisma.orderItem.create({
        data: {
          orderId: order.id,
          documentId: doc.id,
          printConfiguration: fullConfig as unknown as Prisma.InputJsonValue,
          quantity,
          itemType: "PRINT",
          sequence: 0,
        },
      });
      itemId = item.id;
    }
    const job = await fx.prisma.printJob.create({
      data: {
        orderId: order.id,
        shopId: fx.shop.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.QUEUED,
        orderItemId: itemId,
      },
    });
    const rows = await fx.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT (${JOB_TOTAL_PAGES})::int AS total FROM print_jobs j ${JOB_PAGES_JOINS} WHERE j.id = ${job.id}`;
    const expected = jobPages(config, docPages, quantity).total;
    expect(rows[0]!.total).toBe(expected);
  });
});
