import "reflect-metadata";
import { Writable } from "node:stream";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import type { ApiError } from "@print-automated/types";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

// A fake that only implements the one call POST /v1/auth/login actually
// makes before anything else (prisma.user.findUnique) -- enough to
// simulate the DB being unreachable without touching the real dev stack
// that the other e2e suites rely on staying up.
const brokenPrisma = {
  user: {
    findUnique: () => {
      throw new Error("ECONNREFUSED: simulated database outage");
    },
  },
};

describe("Global error model (e2e)", () => {
  let app: NestExpressApplication;
  let logChunks: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(brokenPrisma)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();

    // pino writes straight to the raw fd by default, bypassing
    // process.stdout.write -- routing it through our own Writable is the
    // only reliable way to assert on what actually got logged.
    logChunks = [];
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logChunks.push(chunk.toString("utf8"));
        callback();
      },
    });

    configureApp(app, app.get<ApiEnv>(API_ENV), { logStream });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("an induced DB failure returns a typed, retryable error carrying a request_id that appears in the log line", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "whoever@print-automated.dev", password: "irrelevant-password-123" });

    // The typed error contract (§104), exactly the shape ApiError specifies.
    const body = response.body as ApiError;
    expect(response.status).toBe(500);
    expect(body.error_code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.retryable).toBe(true);
    expect(typeof body.request_id).toBe("string");
    expect(body.request_id.length).toBeGreaterThan(0);
    // The client never sees the real cause -- no stack trace, no
    // "ECONNREFUSED", no DB error string.
    expect(body.message).not.toContain("ECONNREFUSED");
    expect(body.message).not.toContain("Prisma");

    // The same request_id shows up server-side, correlating the log
    // line with the response the client received.
    const logOutput = logChunks.join("");
    expect(logOutput).toContain(body.request_id);
    expect(logOutput).toContain("Unhandled exception");
    expect(logOutput).toContain("ECONNREFUSED: simulated database outage");
  });
});
