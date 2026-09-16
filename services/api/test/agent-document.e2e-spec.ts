import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PrintJobStatus,
  PrinterStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import {
  PrismaService,
  StorageService,
  CryptoService,
  KEY_MANAGEMENT_SERVICE,
  type KeyManagementService,
} from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { AgentPairingCodeService } from "../src/shop-agents/agent-pairing-code.service.js";

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

/** §64/9.8, e2e: the agent read path deferred at 2.8, now authorized
 * against job assignment + job status instead of document ownership.
 * Sets up a genuinely encrypted, stored document (the same technique
 * documents.e2e-spec.ts's "Document download" suite uses) so this
 * proves a real decrypt round-trip, not just an authorization check
 * against a placeholder row. */
describe("Agent document fetch (9.8, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let crypto: CryptoService;
  let kms: KeyManagementService;
  let pairingCodeService: AgentPairingCodeService;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shop: { id: string };
  let counter: { id: string };
  const plaintext = Buffer.from("%PDF-1.7\nagent document fetch test content\n%%EOF");

  const deviceIds: string[] = [];
  const printerIds: string[] = [];
  const orderIds: string[] = [];

  async function registerAndAuthenticate(): Promise<{ deviceId: string; accessToken: string }> {
    const { code } = await pairingCodeService.issue(shop.id, counter.id);
    const { publicKeyBase64Url, privateKey } = generateAgentKeypair();
    const deviceId = randomUUID();
    deviceIds.push(deviceId);

    await request(app.getHttpServer())
      .post("/v1/agents/register")
      .send({ pairingCode: code, deviceId, publicKey: publicKeyBase64Url })
      .expect(201);

    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    const signature = signNonce(privateKey, challenge.body.nonce as string);
    const auth = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature });

    return { deviceId, accessToken: auth.body.accessToken as string };
  }

  async function createPrinterForAgent(deviceId: string): Promise<{ id: string }> {
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    const printer = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agent.id,
        name: `Agent Doc E2E Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function seedJob(printerId: string, status: PrintJobStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-AGENTDOC-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 1200, currency: "PKR" } },
        orderStatus: OrderStatus.QUEUED_FOR_PRINT,
      },
    });
    orderIds.push(order.id);

    const job = await prisma.printJob.create({
      data: {
        orderId: order.id,
        printerId,
        shopId: shop.id,
        idempotencyToken: randomUUID(),
        status,
        claimedAt: status === PrintJobStatus.QUEUED ? null : new Date(),
      },
    });
    return job.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    crypto = app.get(CryptoService);
    kms = app.get(KEY_MANAGEMENT_SERVICE);
    pairingCodeService = app.get(AgentPairingCodeService);

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Agent Doc E2E Customer",
        email: `agent-doc-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });

    documentId = randomUUID();
    const { plaintextDek, wrappedDek } = await kms.generateDataKey();
    const encrypted = await crypto.encryptBuffer(plaintext, plaintextDek);
    const documentKey = storage.documentKey(documentId);
    await storage.putObjectBuffer(documentKey, encrypted.ciphertext, "application/octet-stream");
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: customer.id,
        storageKey: documentKey,
        filename: "agent-doc-fetch.pdf",
        mimeType: "application/pdf",
        sizeBytes: plaintext.length,
        status: DocumentStatus.READY,
        pageCount: 1,
        checksum: "irrelevant-for-this-test",
        encryptedDek: new Uint8Array(wrappedDek),
        iv: new Uint8Array(encrypted.iv),
        authTag: new Uint8Array(encrypted.authTag),
        encryptionVersion: encrypted.encryptionVersion,
      },
    });

    shop = await prisma.shop.create({
      data: { name: `Agent Doc E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    const counterUser = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Agent Doc E2E Counter",
        email: `agent-doc-e2e-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counterUser.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counter = counterUser;
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({ where: { userId: counter.id } });
    await storage.deleteObject(storage.documentKey(documentId)).catch(() => undefined);
    await prisma.auditLog.deleteMany({
      where: { resourceType: "document", resourceId: documentId },
    });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customer.id, counter.id] } } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  });

  it("a CLAIMED job's owning agent downloads the exact decrypted bytes, audited with no human actor", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, PrintJobStatus.CLAIMED);

    const res = await request(app.getHttpServer())
      .get(`/v1/agents/jobs/${jobId}/document`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(res.body as Buffer).equals(plaintext)).toBe(true);

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: "document", resourceId: documentId, action: "DOCUMENT_ACCESSED" },
    });
    const thisJobsAudit = auditRows.find(
      (row) => (row.metadata as Record<string, unknown> | null)?.jobId === jobId,
    );
    expect(thisJobsAudit).toBeDefined();
    expect(thisJobsAudit?.actorId).toBeNull();
  });

  it("also allowed while PRINTING -- an agent resuming after its own restart mid-job", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, PrintJobStatus.PRINTING);

    const res = await request(app.getHttpServer())
      .get(`/v1/agents/jobs/${jobId}/document`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer).equals(plaintext)).toBe(true);
  });

  it("refuses a QUEUED (not yet claimed) job's document with 409, not the file", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, PrintJobStatus.QUEUED);

    const res = await request(app.getHttpServer())
      .get(`/v1/agents/jobs/${jobId}/document`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("JOB_NOT_CLAIMED");
  });

  it("refuses a job already PRINTED -- fetching after the fact is refused, not silently re-served", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, PrintJobStatus.PRINTED);

    const res = await request(app.getHttpServer())
      .get(`/v1/agents/jobs/${jobId}/document`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(409);
  });

  it("returns 404 for a different agent's job -- job assignment, not just job status, gates access", async () => {
    const owner = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(owner.deviceId);
    const jobId = await seedJob(printer.id, PrintJobStatus.CLAIMED);

    const stranger = await registerAndAuthenticate();

    const res = await request(app.getHttpServer())
      .get(`/v1/agents/jobs/${jobId}/document`)
      .set("Authorization", `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 401 with no agent token", async () => {
    const { deviceId } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, PrintJobStatus.CLAIMED);

    const res = await request(app.getHttpServer()).get(`/v1/agents/jobs/${jobId}/document`);
    expect(res.status).toBe(401);
  });
});
