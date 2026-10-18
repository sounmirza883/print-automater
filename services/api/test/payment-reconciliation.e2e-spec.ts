import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import { DocumentStatus, PaymentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { MockPaymentProvider } from "../src/payments/mock-payment-provider.js";
import { PaymentReconciliationProcessor } from "../src/payment-reconciliation/payment-reconciliation.processor.js";
import { branchIdOf } from "./helpers/branches.js";

/** 11.4's own Done-when: "an artificially desynchronized payment is
 * flagged, not silently rewritten." Drives the processor directly
 * against real Postgres and the real (in-process) MockPaymentProvider
 * -- same style 5.6/9.4/10.5's own worker-side sweep tests use. */
describe("Payment reconciliation sweep (11.4, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let provider: MockPaymentProvider;
  let processor: PaymentReconciliationProcessor;
  let customerId: string;
  let shopId: string;
  let documentId: string;
  const fakeJob = {} as Job;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    provider = app.get(MockPaymentProvider);
    processor = app.get(PaymentReconciliationProcessor);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Reconciliation E2E Customer",
        email: `reconciliation-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Reconciliation E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/reconciliation/${randomUUID()}`,
        filename: "reconciliation-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  async function createPayment(
    localStatus: PaymentStatus,
    ageMinutes: number,
  ): Promise<{ paymentId: string; providerPaymentId: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-RECON-${randomUUID()}`,
        customerId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
      },
    });
    const session = await provider.createCheckout({
      orderId: order.id,
      amountMinor: 1000,
      currency: "PKR",
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor: 1000,
        currency: "PKR",
        status: localStatus,
      },
    });
    // Same test-only backdating pattern as 5.6/10.5's own sweep specs
    // -- payments only ever change via real application code, which is
    // what makes updated_at a reliable "how long has this sat like
    // this" proxy to simulate without an actual wait.
    await prisma.$executeRaw`
      UPDATE payments SET updated_at = NOW() - (${ageMinutes} * INTERVAL '1 minute') WHERE id = ${payment.id}
    `;
    return { paymentId: payment.id, providerPaymentId: session.providerPaymentId };
  }

  it("a payment whose local status agrees with the provider is not flagged", async () => {
    const { paymentId, providerPaymentId } = await createPayment(PaymentStatus.PAID, 999);
    provider.recordEvent(providerPaymentId, "PAID");

    // Scoped to this payment specifically, not the sweep's own global
    // divergentCount -- the shared dev database can carry unrelated
    // payment rows from other e2e spec files (each with its own,
    // separately-scoped MockPaymentProvider instance whose ledger has
    // no entry for a payment some OTHER test created), which is a real
    // but harmless source of *other* divergences this test has no
    // business asserting about.
    await processor.process(fakeJob);
    const audits = await prisma.auditLog.count({
      where: {
        resourceType: "payment",
        resourceId: paymentId,
        action: "PAYMENT_RECONCILIATION_DIVERGENCE",
      },
    });
    expect(audits).toBe(0);
  });

  it("11.4's own Done-when: an artificially desynchronized payment is flagged via an audit row, without rewriting its local status", async () => {
    const { paymentId, providerPaymentId } = await createPayment(PaymentStatus.PENDING, 999);
    provider.recordEvent(providerPaymentId, "PAID");

    const result = await processor.process(fakeJob);
    expect(result.divergentCount).toBeGreaterThanOrEqual(1);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        resourceType: "payment",
        resourceId: paymentId,
        action: "PAYMENT_RECONCILIATION_DIVERGENCE",
      },
    });
    expect(audit.metadata).toMatchObject({ localStatus: "PENDING", providerOutcome: "PAID" });

    // The whole point: flagged as data, never silently rewritten.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it("a payment still inside the grace window is not checked yet, even if it would diverge", async () => {
    const { paymentId, providerPaymentId } = await createPayment(PaymentStatus.PENDING, 1);
    provider.recordEvent(providerPaymentId, "PAID");

    await processor.process(fakeJob);

    const audits = await prisma.auditLog.count({
      where: {
        resourceType: "payment",
        resourceId: paymentId,
        action: "PAYMENT_RECONCILIATION_DIVERGENCE",
      },
    });
    expect(audits).toBe(0);
  });

  it("a REFUND_PENDING payment is skipped -- refund state has no comparable provider outcome", async () => {
    const { paymentId, providerPaymentId } = await createPayment(PaymentStatus.REFUND_PENDING, 999);
    provider.recordEvent(providerPaymentId, "PAID");

    await processor.process(fakeJob);

    const audits = await prisma.auditLog.count({
      where: {
        resourceType: "payment",
        resourceId: paymentId,
        action: "PAYMENT_RECONCILIATION_DIVERGENCE",
      },
    });
    expect(audits).toBe(0);
  });

  it("a persistent divergence is flagged again on every tick, not silenced after the first", async () => {
    const { paymentId, providerPaymentId } = await createPayment(PaymentStatus.PENDING, 999);
    provider.recordEvent(providerPaymentId, "FAILED");

    await processor.process(fakeJob);
    await processor.process(fakeJob);

    const audits = await prisma.auditLog.count({
      where: {
        resourceType: "payment",
        resourceId: paymentId,
        action: "PAYMENT_RECONCILIATION_DIVERGENCE",
      },
    });
    expect(audits).toBe(2);
  });
});
