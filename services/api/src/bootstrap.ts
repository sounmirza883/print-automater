import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodValidationPipe } from "nestjs-zod";
import type { ApiEnv } from "@print-automated/config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";

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

  app.use(helmet());

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
}
