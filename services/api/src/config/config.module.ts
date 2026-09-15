import { Global, Module } from "@nestjs/common";
import { apiEnvSchema, loadEnvOrExit } from "@print-automated/config";

export const API_ENV = Symbol("API_ENV");

/** Parses and validates the full apiEnvSchema exactly once, at module
 * registration time, and exposes it to any injectable via
 * @Inject(API_ENV). main.ts also reads it post-bootstrap via
 * app.get(API_ENV) for its own needs (port, CORS) rather than
 * re-parsing process.env. */
@Global()
@Module({
  providers: [{ provide: API_ENV, useValue: loadEnvOrExit(apiEnvSchema) }],
  exports: [API_ENV],
})
export class AppConfigModule {}
