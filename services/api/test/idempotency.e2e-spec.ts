import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  UseInterceptors,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { PrismaModule, PrismaService } from "@print-automated/backend-shared";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter.js";
import { IdempotencyInterceptor } from "../src/idempotency/idempotency.interceptor.js";

/** A minimal, purpose-built endpoint proving the interceptor's own
 * mechanics -- 5.3's own Done-when lists order creation, shop
 * acceptance, agent status reporting, and refunds as its eventual
 * consumers, but none of those endpoints exist yet (order creation is
 * 5.5, the very next sub-phase; the rest are Phases 8/9/11). Testing
 * the reusable interceptor against a throwaway controller here, then
 * wiring it onto real endpoints as each one comes into existence, is
 * the same "build the general mechanism now, apply it to the specific
 * case once it exists" split 2.8 and 4.4 already used. `callCount` is
 * what actually proves the guarantee that matters: the underlying
 * handler runs at most once per key, not just that the HTTP response
 * looks the same on a replay. */
@Injectable()
class CallCounter {
  count = 0;
}

@Controller("idempotency-test")
class IdempotencyTestController {
  constructor(private readonly callCounter: CallCounter) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.CREATED)
  handle(@Body() body: unknown): { callCount: number; echo: unknown } {
    this.callCounter.count += 1;
    return { callCount: this.callCounter.count, echo: body };
  }

  @Post("fail")
  @UseInterceptors(IdempotencyInterceptor)
  handleFail(): never {
    this.callCounter.count += 1;
    throw new Error("Simulated failure, for the abandon-on-error test");
  }
}

describe("IdempotencyInterceptor (5.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let callCounter: CallCounter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [IdempotencyTestController],
      providers: [IdempotencyInterceptor, CallCounter],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // AllExceptionsFilter reads request.log (set by pino-http in the
    // real bootstrap.ts) -- without this, a non-500 exception's `.warn`
    // call throws on `undefined`, and Nest's own fallback handler
    // silently replaces the intended status/body with a bare 500,
    // masking the interceptor's real (and correct) behavior entirely.
    app.use(pinoHttp({ level: "silent" }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    callCounter = app.get(CallCounter);
  });

  afterAll(async () => {
    await app.close();
  });

  it("a request with no Idempotency-Key header runs normally, unguarded", async () => {
    const before = callCounter.count;
    const res = await request(app.getHttpServer()).post("/idempotency-test").send({ a: 1 });
    expect(res.status).toBe(201);
    expect(callCounter.count).toBe(before + 1);
  });

  it("§92: a replay with the same key returns the stored response, without running the handler again", async () => {
    const key = randomUUID();
    const before = callCounter.count;

    const first = await request(app.getHttpServer())
      .post("/idempotency-test")
      .set("Idempotency-Key", key)
      .send({ order: "one" });
    expect(first.status).toBe(201);
    expect(callCounter.count).toBe(before + 1);
    expect(first.body).toEqual({ callCount: before + 1, echo: { order: "one" } });

    const replay = await request(app.getHttpServer())
      .post("/idempotency-test")
      .set("Idempotency-Key", key)
      .send({ order: "one" });

    expect(replay.status).toBe(201);
    // The handler did NOT run again -- callCount stayed exactly the
    // same as the first response, and the counter itself never moved.
    expect(replay.body).toEqual(first.body);
    expect(callCounter.count).toBe(before + 1);
  });

  it("the same key with a different body is refused with 422, and never reaches the handler", async () => {
    const key = randomUUID();
    const before = callCounter.count;

    const first = await request(app.getHttpServer())
      .post("/idempotency-test")
      .set("Idempotency-Key", key)
      .send({ order: "first-body" });
    expect(first.status).toBe(201);
    expect(callCounter.count).toBe(before + 1);

    const mismatched = await request(app.getHttpServer())
      .post("/idempotency-test")
      .set("Idempotency-Key", key)
      .send({ order: "a-different-body" });

    expect(mismatched.status).toBe(422);
    expect(mismatched.body.error_code).toBe("IDEMPOTENCY_KEY_REUSED");
    // Refused before ever reaching the handler -- the counter is
    // unchanged from the first, successful call.
    expect(callCounter.count).toBe(before + 1);
  });

  it("two concurrent requests with the same key run the handler exactly once between them", async () => {
    const key = randomUUID();
    const before = callCounter.count;

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post("/idempotency-test")
        .set("Idempotency-Key", key)
        .send({ order: "concurrent" }),
      request(app.getHttpServer())
        .post("/idempotency-test")
        .set("Idempotency-Key", key)
        .send({ order: "concurrent" }),
    ]);

    // Exactly one of the two actually ran the handler (201 with a real
    // body); the other either replayed that same response or, if it
    // lost the race while the first was still in flight, got a 409 --
    // never a second, independent execution.
    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBeGreaterThanOrEqual(201);
    expect(callCounter.count).toBe(before + 1);
    const successes = [first, second].filter((res) => res.status === 201);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    // Deep equality, not a raw JSON-string comparison -- a replayed
    // body round-trips through Postgres' jsonb column, which does not
    // preserve key insertion order the way the original response's
    // plain object literal does, so two semantically identical bodies
    // can legitimately serialize to different strings.
    for (const success of successes) {
      expect(success.body).toEqual(successes[0]?.body);
    }
  });

  it("a handler that throws leaves the key retryable, not permanently stuck replaying a failure", async () => {
    const key = randomUUID();
    const before = callCounter.count;

    const first = await request(app.getHttpServer())
      .post("/idempotency-test/fail")
      .set("Idempotency-Key", key)
      .send({});
    expect(first.status).toBe(500);
    expect(callCounter.count).toBe(before + 1);

    // The pending claim was deleted on failure (the interceptor's own
    // abandon path) -- a retry with the same key is free to attempt
    // again, not refused as "still in progress" and not stuck forever
    // replaying the failed response.
    const retry = await request(app.getHttpServer())
      .post("/idempotency-test/fail")
      .set("Idempotency-Key", key)
      .send({});
    expect(retry.status).toBe(500);
    expect(callCounter.count).toBe(before + 2);

    await prisma.idempotencyKey.deleteMany({ where: { key } });
  });
});
