import { Global, Module } from "@nestjs/common";
import { RequestCounterService } from "./request-counter.service.js";

// Global for the same reason AuditModule is: bootstrap.ts's global request
// middleware needs it via app.get(), and any feature module (AdminModule
// today) that wants the live traffic figures should be able to inject it
// without a per-module import.
@Global()
@Module({
  providers: [RequestCounterService],
  exports: [RequestCounterService],
})
export class ObservabilityModule {}
