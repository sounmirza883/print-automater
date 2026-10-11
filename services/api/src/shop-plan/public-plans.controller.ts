import { Controller, Get } from "@nestjs/common";
import type { PublicPlansResponse } from "@print-automated/types";
import { PlanDefinitionService } from "./plan-definition.service.js";

/** The plans and Compare-table rows an admin manages at `/admin/plans`, as the public
 * marketing site's pricing section reads them. Deliberately no auth guard (like
 * `GET /shops`): a visitor sees prices before they have an account. Read-only and
 * limited to `PublicPlansResponse`, so it exposes nothing the pricing page does not
 * print. */
@Controller("plans")
export class PublicPlansController {
  constructor(private readonly plans: PlanDefinitionService) {}

  @Get()
  list(): Promise<PublicPlansResponse> {
    return this.plans.listPublic();
  }
}
