import { Global, Module } from "@nestjs/common";
import { workerEnvSchema, loadEnvOrExit } from "@print-automated/config";

export const WORKER_ENV = Symbol("WORKER_ENV");

/** Same pattern as services/api's AppConfigModule (1.1, config.module.ts):
 * computed once at module evaluation time via ES module caching, so
 * every importer -- this file's own provider, app.module.ts's forRoot()
 * calls, tests -- gets the exact same object rather than each
 * re-parsing process.env. */
export const workerEnv = loadEnvOrExit(workerEnvSchema);

@Global()
@Module({
  providers: [{ provide: WORKER_ENV, useValue: workerEnv }],
  exports: [WORKER_ENV],
})
export class WorkerConfigModule {}
