import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplicationContext } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { DocumentStatus, ShopStatus, UserRole } from "@prisma/client";
import {
  EMAIL_TRANSPORT,
  PrismaService,
  QUEUE_NAMES,
  type EmailTransport,
  type SendEmailJob,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { SendEmailProcessor } from "../src/notifications/send-email.processor.js";
import { branchIdOf } from "./helpers/branches.js";

const MAILHOG_HTTP_URL = "http://localhost:8025";

interface MailhogMessage {
  Content: { Body: string };
  Raw: { To: string[] };
}

async function waitForMessage(subject: string, timeoutMs = 10_000): Promise<MailhogMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILHOG_HTTP_URL}/api/v2/search?kind=containing&query=${encodeURIComponent(subject)}`,
    );
    const body = (await res.json()) as { items: MailhogMessage[] };
    if (body.items[0]) {
      return body.items[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for an email with subject containing "${subject}"`);
}

/** §78/7.2's own Done-when: "a transport failure retries without
 * rolling back the order transition that triggered it." The two
 * halves are tested separately and for good reason: the first (real
 * delivery through the real queue) needs the real processor and a
 * real transport; the second (a transport failure actually retries)
 * needs a controlled failure, which real MailHog can't be made to
 * produce on demand -- driving `SendEmailProcessor.process()` directly
 * with a broken transport exercises exactly the throw that makes
 * BullMQ's own retry/backoff (SEND_EMAIL_JOB_OPTIONS) take over,
 * without a test actually waiting through real backoff delays. */
describe("Notifications queue + SendEmailProcessor (7.2, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let queue: Queue<SendEmailJob>;
  let customerId: string;
  let shopId: string;
  let documentId: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();

    prisma = app.get(PrismaService);
    queue = app.get(getQueueToken(QUEUE_NAMES.NOTIFICATIONS));

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Send Email E2E Customer",
        email: `send-email-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Send Email E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/send-email/${randomUUID()}`,
        filename: "send-email-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-EMAIL-${randomUUID()}`,
        customerId,
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
    await prisma.notification.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  it("a job added to the real queue is consumed by the real processor, delivers to MailHog, and stamps the notification's sentAt", async () => {
    const notification = await prisma.notification.create({
      data: {
        userId: customerId,
        orderId,
        type: "PAYMENT_CONFIRMED",
        channel: "EMAIL",
        payload: {},
      },
    });
    const subject = `Payment confirmed ${randomUUID()}`;

    await queue.add("send-email", {
      to: "customer@print-automated.dev",
      subject,
      text: "Your payment has been confirmed.",
      notificationId: notification.id,
    });

    const message = await waitForMessage(subject);
    expect(message.Content.Body).toContain("Your payment has been confirmed.");

    // Poll: the processor's DB update happens after MailHog already
    // has the message, so there's a small window before it's visible.
    const deadline = Date.now() + 5000;
    let sentAt: Date | null = null;
    while (Date.now() < deadline) {
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      sentAt = row.sentAt;
      if (sentAt) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(sentAt).not.toBeNull();
  }, 20_000);

  it("a transport failure propagates out of process() rather than being swallowed -- this IS what triggers BullMQ's own retry", async () => {
    const failingTransport: EmailTransport = {
      send: async () => {
        throw new Error("SMTP connection refused");
      },
    };
    const testModule = await Test.createTestingModule({
      providers: [
        SendEmailProcessor,
        { provide: EMAIL_TRANSPORT, useValue: failingTransport },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const processor = testModule.get(SendEmailProcessor);

    await expect(
      processor.process({
        data: { to: "customer@print-automated.dev", subject: "x", text: "y" },
      } as never),
    ).rejects.toThrow("SMTP connection refused");
  });

  it("enqueueing never blocks on delivery -- add() resolves immediately regardless of whether the consumer will ever succeed", async () => {
    const startedAt = Date.now();
    await queue.add("send-email", {
      to: "customer@print-automated.dev",
      subject: `Never awaited ${randomUUID()}`,
      text: "irrelevant",
    });
    // A real SMTP round trip to MailHog plus DNS/connect overhead is
    // easily tens of milliseconds; add() completing this fast is only
    // possible because it's a Redis write, not a wait for delivery.
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
