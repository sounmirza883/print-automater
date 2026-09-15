import { Global, Module } from "@nestjs/common";
import { apiEnvSchema, loadEnvOrExit } from "@print-automated/config";

export const API_ENV = Symbol("API_ENV");

/** Computed once, at module evaluation time -- ES module caching means
 * every importer (this file's own provider, app.module.ts's forRoot()
 * calls, tests) gets the exact same object rather than each re-parsing
 * process.env. */
export const apiEnv = loadEnvOrExit(apiEnvSchema);

/** Exposes the same value to any injectable via @Inject(API_ENV).
 * main.ts also reads it post-bootstrap via app.get(API_ENV) for its own
 * needs (port, CORS) rather than importing apiEnv directly. */
@Global()
@Module({
  providers: [{ provide: API_ENV, useValue: apiEnv }],
  exports: [API_ENV],
})
export class AppConfigModule {}
