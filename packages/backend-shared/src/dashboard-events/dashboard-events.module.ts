import { Global, Module } from "@nestjs/common";
import { DashboardEventsService } from "./dashboard-events.service.js";

/// Global within whichever app registers it, matching RedisModule's own pattern (it depends
/// only on the also-global REDIS_CLIENT): both services/api (SSE subscribers) and
/// services/worker (the print-timeout/printer-offline sweeps transition jobs/orders too, and
/// must be able to publish) need it.
@Global()
@Module({
  providers: [DashboardEventsService],
  exports: [DashboardEventsService],
})
export class DashboardEventsModule {}
