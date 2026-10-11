import { Controller, Get } from "@nestjs/common";
import type { PublicPlanResponse } from "./plan-definition-response.js";
import { PlanDefinitionService } from "./plan-definition.service.js";

/** The plans an admin manages at `/admin/plans`, as the public marketing site's
 * pricing section reads them. Deliberately no auth guard (like `GET /shops`): a
 * visitor sees prices before they have an account. Read-only and limited to
 * `PublicPlanResponse`, so it exposes nothing the pricing page does not print. */
@Controller("plans")
export class PublicPlansController {
  constructor(private readonly plans: PlanDefinitionService) {}

  @Get()
  list(): Promise<{ items: PublicPlanResponse[] }> {
    return this.plans.listPublic();
  }
}
