import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { PlanFeatureResponse } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { CreatePlanFeatureDto, UpdatePlanFeatureDto } from "./dto/plan-feature.dto.js";
import { PlanFeatureService } from "./plan-feature.service.js";

/** The rows of the public Compare plans table. Same gate as PlanDefinitionsController
 * (`@Roles(ADMIN)`, no shop scope): a feature row belongs to the platform. */
@Controller("admin/plan-features")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PlanFeaturesController {
  constructor(private readonly features: PlanFeatureService) {}

  @Get()
  list(): Promise<{ items: PlanFeatureResponse[] }> {
    return this.features.list();
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreatePlanFeatureDto,
  ): Promise<PlanFeatureResponse> {
    return this.features.create(req.user!.id, dto);
  }

  @Patch(":id")
  update(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanFeatureDto,
  ): Promise<PlanFeatureResponse> {
    return this.features.update(req.user!.id, id, dto);
  }

  @Delete(":id")
  remove(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ result: "DELETED" }> {
    return this.features.remove(req.user!.id, id);
  }
}
