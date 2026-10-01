import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { PlanDefinitionResponse } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { CreatePlanDefinitionDto, UpdatePlanDefinitionDto } from "./dto/plan-definition.dto.js";
import { PlanDefinitionService } from "./plan-definition.service.js";

/** Plan management: platform-wide plan definitions. Same gate as AdminController
 * (`@Roles(ADMIN)` at class level, no ShopScopeGuard -- a plan belongs to the
 * platform, not to a business); lives next to ShopPlanService rather than inside
 * AdminController because it is its own resource, not a view of a business. The
 * per-business assign/renew/cancel routes stay on AdminController under
 * `/admin/businesses/:shopId/plan`. */
@Controller("admin/plans")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PlanDefinitionsController {
  constructor(private readonly plans: PlanDefinitionService) {}

  @Get()
  list(): Promise<{ items: PlanDefinitionResponse[] }> {
    return this.plans.list();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<PlanDefinitionResponse> {
    return this.plans.get(id);
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreatePlanDefinitionDto,
  ): Promise<PlanDefinitionResponse> {
    return this.plans.create(req.user!.id, dto);
  }

  @Patch(":id")
  update(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDefinitionDto,
  ): Promise<PlanDefinitionResponse> {
    return this.plans.update(req.user!.id, id, dto);
  }

  /** 200 with a body (not 204): the client contract is `{ result: "DELETED" }`. */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  remove(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ result: "DELETED" }> {
    return this.plans.remove(req.user!.id, id);
  }
}
