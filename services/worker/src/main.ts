import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

/** No HTTP server -- this process only consumes BullMQ jobs, so
 * createApplicationContext (not create()+listen()) is the correct
 * NestJS entry point. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log("Worker started, listening for jobs.", "Bootstrap");
}

void bootstrap();
