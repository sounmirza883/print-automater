import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { OrderNumberService } from "../src/orders/order-number.service.js";

/** §5.2's own Done-when: 500 concurrent creations produce 500 unique,
 * gapless numbers -- against real Postgres, real concurrency (a real
 * `Promise.all` of 500 simultaneous connections racing the same
 * `INSERT ... ON CONFLICT ... RETURNING`, not a serialized loop
 * pretending to be concurrent). Uses a contrived, far-past date (year
 * 1900) so its `date_key` can never collide with real counter state
 * from an actual order, any other test, or a previous run of this
 * same test on the same real UTC day. */
describe("Order number generator (5.2, e2e)", () => {
  let prisma: PrismaService;
  let orderNumberService: OrderNumberService;
  const testDate = new Date(Date.UTC(1900, 0, 1));
  const testDateKey = "19000101";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    orderNumberService = app.get(OrderNumberService);
  });

  afterAll(async () => {
    await prisma.orderNumberCounter.deleteMany({ where: { dateKey: testDateKey } });
  });

  it("PA-YYYYMMDD-NNNNNN format, zero-padded to 6 digits", async () => {
    const orderNumber = await orderNumberService.generate(testDate);
    expect(orderNumber).toMatch(/^PA-19000101-\d{6}$/);
  });

  it("500 concurrent calls on the same date produce 500 unique, gapless numbers", async () => {
    await prisma.orderNumberCounter.deleteMany({ where: { dateKey: testDateKey } });

    const results = await Promise.all(
      Array.from({ length: 500 }, () => orderNumberService.generate(testDate)),
    );

    const counters = results
      .map((orderNumber) => {
        const match = /^PA-19000101-(\d{6})$/.exec(orderNumber);
        if (!match?.[1]) {
          throw new Error(`Unexpected order number format: ${orderNumber}`);
        }
        return Number(match[1]);
      })
      .sort((a, b) => a - b);

    // Unique: a Set collapses duplicates, so its size only matches the
    // count if every one of the 500 was distinct.
    expect(new Set(counters).size).toBe(500);
    // Gapless: sorted, this is exactly 1, 2, 3, ..., 500 -- no skipped
    // or re-used values anywhere in the sequence.
    expect(counters).toEqual(Array.from({ length: 500 }, (_, index) => index + 1));
  }, 30_000);

  it("resets per day -- a different date starts its own counter at 1", async () => {
    const otherDate = new Date(Date.UTC(1901, 0, 1));
    const otherDateKey = "19010101";
    try {
      const orderNumber = await orderNumberService.generate(otherDate);
      expect(orderNumber).toBe("PA-19010101-000001");
    } finally {
      await prisma.orderNumberCounter.deleteMany({ where: { dateKey: otherDateKey } });
    }
  });
});
