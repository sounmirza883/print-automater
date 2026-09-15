import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: is the process up and able to handle a request at all?
   * Deliberately checks nothing external -- a downstream outage should
   * not make the orchestrator kill and restart a perfectly healthy
   * process. */
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: can this instance actually serve traffic right now?
   * Postgres + Redis + S3 (§ design 1.8) all reachable, or 503. */
  @Get("ready")
  async ready(): Promise<{ status: "ready"; checks: unknown }> {
    const result = await this.healthService.checkReadiness();
    if (!result.ready) {
      throw new ServiceUnavailableException({ status: "not_ready", checks: result.checks });
    }
    return { status: "ready", checks: result.checks };
  }
}
