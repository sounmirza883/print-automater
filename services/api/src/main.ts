import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { VersioningType } from "@nestjs/common";
import helmet from "helmet";
import { ZodValidationPipe } from "nestjs-zod";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "./app.module.js";
import { API_ENV } from "./config/config.module.js";

async function bootstrap(): Promise<void> {
  // rawBody: true exposes req.rawBody so Phase 6's payment webhook can
  // verify the provider's HMAC signature against the exact bytes received,
  // before any body-parser JSON transformation.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // AppConfigModule already validated the full environment once at
  // module-init time; reuse that instead of parsing process.env again.
  const env = app.get<ApiEnv>(API_ENV);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });

  app.use(helmet());
  app.useGlobalPipes(new ZodValidationPipe());

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
