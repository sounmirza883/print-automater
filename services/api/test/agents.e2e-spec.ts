import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { PrinterAgentStatus, ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import jwt from "jsonwebtoken";
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

describe("Agent registration & authentication (9.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;
  let apiEnv: ApiEnv;

  let shop: { id: string };
  let counter: { id: string; role: UserRole };
  const deviceIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    pairingCodeService = app.get(AgentPairingCodeService);
    apiEnv = app.get<ApiEnv>(API_ENV);

    shop = await prisma.shop.create({
      data: { name: `Agents E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Agents E2E Counter",
        email: `agents-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    await prisma.printerAgent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.auditLog.deleteMany({ where: { resourceType: "printer_agent" } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({ where: { userId: counter.id } });
    await prisma.user.deleteMany({ where: { id: counter.id } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  });

  async function registerRealAgent(): Promise<{ deviceId: string; privateKey: KeyObject }> {
    const { code } = await pairingCodeService.issue(shop.id, counter.id);
    const { publicKeyBase64Url, privateKey } = generateAgentKeypair();
    const deviceId = randomUUID();
    deviceIds.push(deviceId);

    const res = await request(app.getHttpServer())
      .post("/v1/agents/register")
      .send({ pairingCode: code, deviceId, publicKey: publicKeyBase64Url });
    expect(res.status).toBe(201);
    return { deviceId, privateKey };
  }

  it("registers a device with a valid pairing code, and audits PRINTER_REGISTERED", async () => {
    const { code } = await pairingCodeService.issue(shop.id, counter.id);
    const { publicKeyBase64Url } = generateAgentKeypair();
    const deviceId = randomUUID();
    deviceIds.push(deviceId);

    const res = await request(app.getHttpServer())
      .post("/v1/agents/register")
      .send({ pairingCode: code, deviceId, publicKey: publicKeyBase64Url });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ deviceId, shopId: shop.id });

    const stored = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    expect(stored.status).toBe(PrinterAgentStatus.ACTIVE);
    expect(stored.publicKey).toBe(publicKeyBase64Url);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceType: "printer_agent", resourceId: stored.id },
    });
    expect(audit.action).toBe("PRINTER_REGISTERED");
    expect(audit.actorId).toBeNull();
  });

  it("registration with an invalid/consumed pairing code is refused (410)", async () => {
    const { publicKeyBase64Url } = generateAgentKeypair();
    const res = await request(app.getHttpServer())
      .post("/v1/agents/register")
      .send({ pairingCode: "NOTAREAL", deviceId: randomUUID(), publicKey: publicKeyBase64Url });
    expect(res.status).toBe(410);
  });

  it("full challenge/response flow: a correctly-signed nonce yields a real, verifiable agent JWT", async () => {
    const { deviceId, privateKey } = await registerRealAgent();

    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    expect(challenge.status).toBe(200);
    const nonce = challenge.body.nonce as string;
    expect(typeof nonce).toBe("string");

    const signature = signNonce(privateKey, nonce);
    const res = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");

    const payload = jwt.verify(res.body.accessToken, apiEnv.JWT_AGENT_SECRET) as {
      sub: string;
      shopId: string;
      type: string;
    };
    expect(payload.sub).toBe(deviceId);
    expect(payload.shopId).toBe(shop.id);
    expect(payload.type).toBe("agent");
  });

  it("a tampered signature is rejected (401), not silently accepted", async () => {
    const { deviceId, privateKey } = await registerRealAgent();
    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    const nonce = challenge.body.nonce as string;

    const realSignature = signNonce(privateKey, nonce);
    const tampered = `${realSignature.slice(0, -2)}${realSignature.slice(-2) === "AA" ? "BB" : "AA"}`;

    const res = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature: tampered });
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("INVALID_SIGNATURE");
  });

  it("a signature from a different device's private key is rejected", async () => {
    const { deviceId } = await registerRealAgent();
    const { privateKey: someoneElsesKey } = generateAgentKeypair();

    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    const nonce = challenge.body.nonce as string;
    const wrongSignature = signNonce(someoneElsesKey, nonce);

    const res = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature: wrongSignature });
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("INVALID_SIGNATURE");
  });

  it("a challenge request for an unknown device is refused", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId: randomUUID() });
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("UNKNOWN_DEVICE");
  });

  it("authenticating with no pending challenge (or a replayed, already-consumed one) is refused", async () => {
    const { deviceId, privateKey } = await registerRealAgent();

    const neverChallenged = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature: signNonce(privateKey, "some-nonce-never-issued") });
    expect(neverChallenged.status).toBe(401);
    expect(neverChallenged.body.error_code).toBe("CHALLENGE_EXPIRED");

    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    const signature = signNonce(privateKey, challenge.body.nonce as string);

    const first = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature });
    expect(first.status).toBe(200);

    // Replaying the exact same signature: the nonce was already
    // consumed by the successful call above.
    const replay = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature });
    expect(replay.status).toBe(401);
    expect(replay.body.error_code).toBe("CHALLENGE_EXPIRED");
  });
});
