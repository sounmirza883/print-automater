import "reflect-metadata";
import { Writable } from "node:stream";
import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request } from "express";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { configureApp } from "./bootstrap.js";
import { RequestCounterService } from "./observability/request-counter.service.js";

@Controller("probe")
class ProbeController {
  @Get("ip")
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }

  @Post("ip")
  @HttpCode(200)
  postIp(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

const ALLOWED_ORIGIN = "https://order.print-automated.example";

async function appWith(env: Partial<ApiEnv>): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [RequestCounterService],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const silent = new Writable({ write: (_chunk, _enc, done) => done() });
  configureApp(
    app,
    {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      CORS_ALLOWED_ORIGINS: `${ALLOWED_ORIGIN}, http://localhost:3001`,
      TRUST_PROXY_HOPS: 0,
      ...env,
    } as ApiEnv,
    { logStream: silent },
  );
  await app.init();
  return app;
}

/** Fix wave 1: the QR guest wizard now calls the public API straight from the browser,
 * so the API itself -- not a same-origin proxy -- must (a) key per-IP rate limits by the
 * real client address behind exactly as many proxy hops as the deployment has, and
 * (b) answer cross-origin calls from the allowlisted customer-web origin. Both live in
 * configureApp, the one bootstrap main.ts and every e2e suite share. */
describe("configureApp: client IP (trust proxy) and CORS", () => {
  describe("TRUST_PROXY_HOPS = 0 (the default: `pnpm dev`, nothing in front)", () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await appWith({ TRUST_PROXY_HOPS: 0 });
    });
    afterAll(() => app.close());

    it("ignores X-Forwarded-For entirely: a client cannot name its own IP", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/probe/ip")
        .set("X-Forwarded-For", "203.0.113.9");
      expect(res.status).toBe(200);
      expect(res.body.ip).not.toBe("203.0.113.9");
      expect(res.body.ip).toMatch(/127\.0\.0\.1|::1/);
    });
  });

  describe("TRUST_PROXY_HOPS = 1 (production: one TLS reverse proxy on the host)", () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await appWith({ TRUST_PROXY_HOPS: 1 });
    });
    afterAll(() => app.close());

    it("takes the address the proxy appended as the client's", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/probe/ip")
        .set("X-Forwarded-For", "203.0.113.9");
      expect(res.body.ip).toBe("203.0.113.9");
    });

    it("believes only that ONE right-most hop: entries a client prepends itself are ignored", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/probe/ip")
        .set("X-Forwarded-For", "6.6.6.6, 7.7.7.7, 203.0.113.9");
      expect(res.body.ip).toBe("203.0.113.9");
    });
  });

  describe("CORS for a browser calling the API directly", () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await appWith({});
    });
    afterAll(() => app.close());

    it("answers the preflight for a JSON POST with an Idempotency-Key from an allowlisted origin", async () => {
      const res = await request(app.getHttpServer())
        .options("/v1/probe/ip")
        .set("Origin", ALLOWED_ORIGIN)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type,idempotency-key");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
      expect(res.headers["access-control-allow-headers"]).toContain("idempotency-key");
    });

    it("lets that origin read the response, including Retry-After and X-Request-Id", async () => {
      const res = await request(app.getHttpServer())
        .post("/v1/probe/ip")
        .set("Origin", "http://localhost:3001")
        .send({});
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
      const exposed = String(res.headers["access-control-expose-headers"]).toLowerCase();
      expect(exposed).toContain("retry-after");
      expect(exposed).toContain("x-request-id");
    });

    it("grants nothing to an origin outside the allowlist", async () => {
      const res = await request(app.getHttpServer())
        .options("/v1/probe/ip")
        .set("Origin", "https://evil.example")
        .set("Access-Control-Request-Method", "POST");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
