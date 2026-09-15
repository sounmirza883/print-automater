import "reflect-metadata";
import { Controller, Post, Req, VersioningType, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../src/app.module.js";

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
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /v1/health returns 200", async () => {
    const response = await request(app.getHttpServer()).get("/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
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
