import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import type { ApiEnv } from "@print-automated/config";
import { PinoLoggerService } from "@print-automated/backend-shared";
import { AppModule } from "./app.module.js";
import { API_ENV } from "./config/config.module.js";
import { configureApp } from "./bootstrap.js";

async function bootstrap(): Promise<void> {
  // rawBody: true exposes req.rawBody so Phase 6's payment webhook can
  // verify the provider's HMAC signature against the exact bytes received,
  // before any body-parser JSON transformation.
  //
  // §103/12.5: bootstrap.ts's own pino-http middleware already
  // structures every HTTP request/response line -- this `logger`
  // option covers everything else Nest's own `Logger` class produces
  // (module init, and every non-HTTP `new Logger(ClassName)` call this
  // process makes, e.g. payment-reconciliation's own scheduler/
  // processor), which previously went to Nest's default non-JSON
  // console output even in this app. process.env is read directly
  // here (not AppConfigModule's own validated ApiEnv) because the
  // logger must exist before NestFactory.create() ever builds the DI
  // container that ApiEnv would come from -- the same bootstrap-time
  // exception Phase 0.5's own env loader already relies on.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new PinoLoggerService(process.env.LOG_LEVEL),
  });

  // AppConfigModule already validated the full environment once at
  // module-init time; reuse that instead of parsing process.env again.
  const env = app.get<ApiEnv>(API_ENV);

  configureApp(app, env);

  const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(env.PORT);
}

void bootstrap();
