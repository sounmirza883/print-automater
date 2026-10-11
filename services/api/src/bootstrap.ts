import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { json, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodValidationPipe } from "nestjs-zod";
import type { ApiEnv } from "@print-automated/config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { RequestCounterService } from "./observability/request-counter.service.js";

/** 5 MB file as base64 (~6.99M chars) plus the JSON around it. */
const PAYMENT_PROOF_BODY_LIMIT = "8mb";

export interface ConfigureAppOptions {
  /** Test-only: pino writes straight to the raw fd by default (bypassing
   * process.stdout.write entirely) for performance, which makes output
   * impossible to capture from outside. Passing a stream here routes
   * pino-http's output through it instead, so a test can assert on log
   * content deterministically. Never set outside tests. */
  logStream?: NodeJS.WritableStream;
}

/** Shared by main.ts and every e2e test's bootstrap, so tests exercise
 * the exact same middleware/filter/pipe stack as production rather than
 * a hand-rolled approximation that can silently drift from it. */
export function configureApp(
  app: NestExpressApplication,
  env: ApiEnv,
  options: ConfigureAppOptions = {},
): void {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // Fix wave 1: req.ip keys every per-IP rate limit, and the QR guest wizard now
  // calls the public ordering routes straight from the browser -- so behind a
  // reverse proxy, req.ip must be the real client, not the proxy (otherwise every
  // guest on every shop shares one bucket). Express believes exactly this many
  // right-most X-Forwarded-For entries and no more (see TRUST_PROXY_HOPS in
  // packages/config): 0 = none, for `pnpm dev`/direct exposure; the production
  // compose stack (one TLS reverse proxy on the host) sets 1. Never `true`: a
  // hop trusted that isn't really there lets a client choose its own IP.
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  // CORS lives here (it used to be main.ts-only) so every e2e suite exercises the
  // same cross-origin behaviour production has. A browser calls this API directly
  // from each CORS_ALLOWED_ORIGINS entry -- customer-web's public QR ordering
  // flow above all. No route relies on cookies (auth is a bearer header, and the
  // public routes take none), so credentials are irrelevant to those callers;
  // `credentials: true` is kept as it always was, and is only ever granted to an
  // allowlisted origin, never `*`. Retry-After (a 429's wait) and X-Request-Id
  // (quoted in support requests) are exposed so browser code can read them.
  const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
    exposedHeaders: ["Retry-After", "X-Request-Id"],
  });

  app.use(helmet());

  // Plan-payment proofs arrive as base64 inside JSON (a screenshot of up to 5 MB is
  // ~6.7 MB of base64), far over Express's 100 kb default. Only this route gets the
  // bigger limit -- everything else keeps the default. Mounted before Nest registers its
  // own parser at init, which then skips a request whose body is already parsed.
  //
  // The wrapper is load-bearing: `json()` returns a function NAMED `jsonParser`, and Nest
  // skips registering its own global JSON parser whenever it finds a layer with that name
  // already on the router -- which would silently disable body parsing on EVERY route.
  const paymentProofJson = json({ limit: PAYMENT_PROOF_BODY_LIMIT });
  app.use("/v1/shop/payment-proofs", (req: Request, res: Response, next: NextFunction) =>
    paymentProofJson(req, res, next),
  );

  // Attaches req.id + a child req.log bound to it on every request, so
  // a log line and the response it corresponds to always carry the same
  // request_id (read by AllExceptionsFilter, §104).
  app.use(
    pinoHttp({
      genReqId: (req, res) => {
        const existing = req.headers["x-request-id"];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      level: env.LOG_LEVEL,
      ...(options.logStream
        ? { stream: options.logStream }
        : {
            transport:
              env.NODE_ENV === "development"
                ? { target: "pino-pretty", options: { singleLine: true } }
                : undefined,
          }),
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ZodValidationPipe());

  // 23.7 (admin panel: live system summary) -- the traffic counter behind
  // the admin dashboard's "requests/min" tile. Matches the rest of this
  // function's own pattern (global raw middleware via app.use()) rather
  // than a NestInterceptor: every interceptor elsewhere in this codebase is
  // opt-in per-route/controller (@UseInterceptors(...)), never global, so a
  // genuinely-every-request concern belongs here alongside helmet/pino-http.
  const requestCounter = app.get(RequestCounterService);
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    requestCounter.record();
    next();
  });
}
