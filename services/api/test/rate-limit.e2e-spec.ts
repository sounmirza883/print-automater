import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

describe("Rate limiting (e2e)", () => {
  let app: NestExpressApplication;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  it("§85: login is limited to 5 per 15min per IP+email -- the 6th attempt returns 429 with Retry-After", async () => {
    const email = `rate-limit-e2e-${randomUUID()}@print-automated.dev`;
    // Fresh bucket: this email has never been used before, so there's
    // nothing to flush, but being explicit documents the assumption.
    const keys = await redis.keys(`ratelimit:AuthController:login:*:${email}`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "whatever-wrong-password" });
      // Each of the first 5 is allowed through to the handler (which
      // rejects for bad credentials) -- 401, never 429.
      expect(res.status).toBe(401);
    }

    const sixth = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "whatever-wrong-password" });

    expect(sixth.status).toBe(429);
    expect(sixth.headers["retry-after"]).toBeDefined();
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
    expect(sixth.body).toMatchObject({ error_code: "RATE_LIMITED", retryable: true });
  });

  it("§85: a different email from the same IP is a separate bucket, unaffected by the above", async () => {
    const email = `rate-limit-e2e-other-${randomUUID()}@print-automated.dev`;
    const res = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "irrelevant" });
    expect(res.status).toBe(401); // not 429 -- distinct bucket
  });
});
