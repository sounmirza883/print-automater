import "reflect-metadata";
import { Controller, Post, Req, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

// Test-only controller: exists solely to prove that main.ts's
// `rawBody: true` NestFactory option actually exposes req.rawBody end to
// end. It is never part of the real app module — Phase 6's payment
// webhook endpoint will be the first production consumer of req.rawBody.
@Controller("test-raw-body")
class RawBodyProbeController {
  @Post()
  probe(@Req() req: RawBodyRequest<Request>): { rawBodyReceived: boolean; length: number } {
    return {
      rawBodyReceived: req.rawBody !== undefined,
      length: req.rawBody?.length ?? 0,
    };
  }
}

describe("AppModule (e2e)", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RawBodyProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /v1/health returns 200 (liveness, checks nothing external)", async () => {
    const response = await request(app.getHttpServer()).get("/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /v1/health/ready returns 200 with postgres/redis/s3 all reachable", async () => {
    // Exercises the real dev stack (docker-compose.dev.yml, 0.4) --
    // no mocking, this is the actual readiness contract.
    const response = await request(app.getHttpServer()).get("/v1/health/ready");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    const names = (response.body.checks as { name: string; ok: boolean }[]).map((c) => c.name);
    expect(names.sort()).toEqual(["postgres", "redis", "s3"]);
    for (const check of response.body.checks as { ok: boolean }[]) {
      expect(check.ok).toBe(true);
    }
  });

  it("exposes the raw, unparsed request body on a POST", async () => {
    const payload = '{"hello":"world"}';
    const response = await request(app.getHttpServer())
      .post("/v1/test-raw-body")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ rawBodyReceived: true, length: payload.length });
  });
});
