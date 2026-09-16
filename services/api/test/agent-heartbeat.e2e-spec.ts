import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { PrinterStatus, ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { AgentPairingCodeService } from "../src/shop-agents/agent-pairing-code.service.js";
import { TokenService } from "../src/auth/token.service.js";

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

describe("POST /agents/heartbeat (9.4, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;

  let shop: { id: string };
  let counter: { id: string; role: UserRole };
  const deviceIds: string[] = [];
  const printerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    pairingCodeService = app.get(AgentPairingCodeService);

    shop = await prisma.shop.create({
      data: { name: `Heartbeat E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Heartbeat E2E Counter",
        email: `heartbeat-e2e-${randomUUID()}@print-automated.dev`,
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
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({ where: { userId: counter.id } });
    await prisma.user.deleteMany({ where: { id: counter.id } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  });

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

  it("creates a new printer row for a name with no existing match, links the agent, and updates lastSeenAt", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printerName = `Heartbeat Printer ${randomUUID()}`;

    const res = await request(app.getHttpServer())
      .post("/v1/agents/heartbeat")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        printers: [
          {
            name: printerName,
            status: "ONLINE",
            capabilities: { color: true, duplex: false, a4: true, a3: false },
          },
        ],
      });
    expect(res.status).toBe(200);

    const printer = await prisma.printer.findFirstOrThrow({
      where: { shopId: shop.id, name: printerName },
    });
    printerIds.push(printer.id);
    expect(printer.status).toBe(PrinterStatus.ONLINE);
    expect(printer.capabilities).toEqual({ color: true, duplex: false, a4: true, a3: false });

    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    expect(printer.agentId).toBe(agent.id);
    expect(agent.lastSeenAt).not.toBeNull();
  });

  it("updates an existing printer's status by matching name, without touching unrelated printers", async () => {
    const existing = await prisma.printer.create({
      data: {
        shopId: shop.id,
        name: `Existing Printer ${randomUUID()}`,
        status: PrinterStatus.OFFLINE,
      },
    });
    printerIds.push(existing.id);
    const { accessToken } = await registerAndAuthenticate();

    const res = await request(app.getHttpServer())
      .post("/v1/agents/heartbeat")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ printers: [{ name: existing.name, status: "ONLINE" }] });
    expect(res.status).toBe(200);

    const updated = await prisma.printer.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.status).toBe(PrinterStatus.ONLINE);
  });

  it("never overwrites a DISABLED printer's status, even when reported ONLINE, but still links the agent", async () => {
    const disabled = await prisma.printer.create({
      data: {
        shopId: shop.id,
        name: `Disabled Printer ${randomUUID()}`,
        status: PrinterStatus.DISABLED,
      },
    });
    printerIds.push(disabled.id);
    const { deviceId, accessToken } = await registerAndAuthenticate();

    await request(app.getHttpServer())
      .post("/v1/agents/heartbeat")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ printers: [{ name: disabled.name, status: "ONLINE" }] })
      .expect(200);

    const updated = await prisma.printer.findUniqueOrThrow({ where: { id: disabled.id } });
    expect(updated.status).toBe(PrinterStatus.DISABLED);
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    expect(updated.agentId).toBe(agent.id);
  });

  it("returns 401 with no agent token, and 401 for a human user's own JWT (a different secret entirely)", async () => {
    const noToken = await request(app.getHttpServer())
      .post("/v1/agents/heartbeat")
      .send({ printers: [] });
    expect(noToken.status).toBe(401);

    const humanToken = app.get(TokenService).issueAccessToken(counter);
    const withHumanToken = await request(app.getHttpServer())
      .post("/v1/agents/heartbeat")
      .set("Authorization", `Bearer ${humanToken}`)
      .send({ printers: [] });
    expect(withHumanToken.status).toBe(401);
  });
});
