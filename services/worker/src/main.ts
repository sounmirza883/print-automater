import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PinoLoggerService } from "@print-automated/backend-shared";
import { AppModule } from "./app.module.js";

/** No HTTP server -- this process only consumes BullMQ jobs, so
 * createApplicationContext (not create()+listen()) is the correct
 * NestJS entry point.
 *
 * §103/12.5: the `logger` option here (not `app.useLogger()` called
 * afterward) is what makes even Nest's own startup logs go through
 * Pino -- every scheduler/processor's own `new Logger(ClassName)` call
 * (order expired, printer offline, print job timed out, ...) was
 * previously Nest's default non-JSON console output; nothing in the
 * process is exempt once this is set at creation time. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new PinoLoggerService(process.env.LOG_LEVEL),
  });
  app.enableShutdownHooks();
  Logger.log("Worker started, listening for jobs.", "Bootstrap");
}

void bootstrap();
