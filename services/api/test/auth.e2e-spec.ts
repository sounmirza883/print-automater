import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import type Redis from "ioredis";
import {
  PrismaService,
  QUEUE_NAMES,
  REDIS_CLIENT,
  type SendEmailJob,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

describe("Auth (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let notificationsQueue: Queue<SendEmailJob>;

  const email = `auth-e2e-${randomUUID()}@print-automated.dev`;
  const password = "CorrectHorseBatteryStaple9";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    notificationsQueue = app.get(getQueueToken(QUEUE_NAMES.NOTIFICATIONS));

    // This file makes 3 register calls, right at 1.9's 3/hr-per-IP
    // limit -- flush so repeated local runs against the same dev Redis
    // within an hour don't start seeing 429s the limiter never intended
    // for real traffic (the loopback IP has no per-run randomness).
    const redis = app.get<Redis>(REDIS_CLIENT);
    const keys = await redis.keys("ratelimit:AuthController:register:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } }); // cascades refresh_tokens
    await app.close();
  });

  it("walks register -> login -> refresh -> logout, then rejects a post-logout refresh", async () => {
    // register
    const registerRes = await request(app.getHttpServer()).post("/v1/auth/register").send({
      name: "Auth E2E User",
      email,
      password,
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user.email).toBe(email);
    expect(registerRes.body.user.role).toBe("CUSTOMER");
    expect(typeof registerRes.body.accessToken).toBe("string");
    expect(typeof registerRes.body.refreshToken).toBe("string");

    // a duplicate registration is rejected
    const duplicateRes = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ name: "Someone Else", email, password });
    expect(duplicateRes.status).toBe(409);

    // login
    const loginRes = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password });
    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body as { refreshToken: string };

    // wrong password is rejected
    const badLoginRes = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "wrong password entirely" });
    expect(badLoginRes.status).toBe(401);

    // refresh
    const refreshRes = await request(app.getHttpServer())
      .post("/v1/auth/refresh")
      .send({ refreshToken });
    expect(refreshRes.status).toBe(200);
    const rotatedRefreshToken = refreshRes.body.refreshToken as string;
    expect(rotatedRefreshToken).not.toBe(refreshToken);

    // logout revokes the whole family, including the just-rotated token
    const logoutRes = await request(app.getHttpServer())
      .post("/v1/auth/logout")
      .send({ refreshToken: rotatedRefreshToken });
    expect(logoutRes.status).toBe(204);

    // a refresh attempt after logout must be rejected
    const postLogoutRefreshRes = await request(app.getHttpServer())
      .post("/v1/auth/refresh")
      .send({ refreshToken: rotatedRefreshToken });
    expect(postLogoutRefreshRes.status).toBe(401);

    // login and logout each produced an audit row (1.7)
    const userId = registerRes.body.user.id as string;
    const auditActions = await prisma.auditLog.findMany({
      where: { actorId: userId },
      select: { action: true },
    });
    const actions = auditActions.map((row) => row.action);
    expect(actions).toContain("REGISTER");
    expect(actions).toContain("LOGIN");
    expect(actions).toContain("LOGOUT");
  });

  it("recovery always returns 204 whether or not the email is registered (no enumeration), and only the registered case enqueues a real recovery email", async () => {
    const jobCountBefore = await notificationsQueue.getJobCountByTypes("waiting", "completed");

    const known = await request(app.getHttpServer()).post("/v1/auth/recovery").send({ email });
    const unknown = await request(app.getHttpServer())
      .post("/v1/auth/recovery")
      .send({ email: `nobody-${randomUUID()}@print-automated.dev` });

    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);

    // 7.2 replaced the Phase-1 stub (log instead of email) with a real
    // enqueue -- exactly one job for the known email, none for the
    // unknown one. Actual delivery (via services/worker's own
    // processor consuming this same queue) is services/worker's own
    // e2e test's job, not this one's -- nothing here consumes the
    // queue, so this only asserts the enqueue itself happened.
    const jobCountAfter = await notificationsQueue.getJobCountByTypes("waiting", "completed");
    expect(jobCountAfter).toBe(jobCountBefore + 1);
  });

  it("rejects a malformed register payload before it reaches the service layer", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ name: "", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
  });
});
