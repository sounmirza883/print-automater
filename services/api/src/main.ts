import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { VersioningType } from "@nestjs/common";
import helmet from "helmet";
import { ZodValidationPipe } from "nestjs-zod";
import { apiEnvSchema, loadEnvOrExit } from "@print-automated/config";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const env = loadEnvOrExit(apiEnvSchema);

  // rawBody: true exposes req.rawBody so Phase 6's payment webhook can
  // verify the provider's HMAC signature against the exact bytes received,
  // before any body-parser JSON transformation.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

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
