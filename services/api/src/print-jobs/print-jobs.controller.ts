import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped } from "../auth/shop-scoped.decorator.js";
import { AssignOperatorDto } from "./dto/assign-operator.dto.js";
import { PauseJobDto } from "./dto/pause-job.dto.js";
import { ReassignJobDto } from "./dto/reassign-job.dto.js";
import { RecordFailureReasonDto } from "./dto/record-failure-reason.dto.js";
import { ResumeJobDto } from "./dto/resume-job.dto.js";
import { PrintJobShopResolver } from "./print-job-shop.resolver.js";
import { PrintJobsService, type PrintJobResponse } from "./print-jobs.service.js";

/** 18.7/18.9: both actions here are gated by ASSIGN_JOBS (§47), held
 * by OPERATOR/PRINTER_MANAGER/SHOP_MANAGER/SHOP_OWNER but deliberately
 * NOT SHOP_COUNTER -- reassignment and operator allocation are
 * production-floor/printer-fleet actions, not front-of-house order
 * handling (shop-orders.controller.ts's own class comment draws this
 * same line for change-printer vs. this controller). */
@Controller("print-jobs")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ShopScopeGuard)
@Roles(UserRole.OPERATOR, UserRole.PRINTER_MANAGER, UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)
export class PrintJobsController {
  constructor(private readonly printJobsService: PrintJobsService) {}

  @Post(":id/reassign")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ASSIGN_JOBS)
  @ShopScoped("id", PrintJobShopResolver)
  reassign(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ReassignJobDto,
  ): Promise<PrintJobResponse> {
    return this.printJobsService.reassign(id, req.user!.id, dto.printerId, dto.reason);
  }

  @Post(":id/assign-operator")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ASSIGN_JOBS)
  @ShopScoped("id", PrintJobShopResolver)
  assignOperator(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: AssignOperatorDto,
  ): Promise<PrintJobResponse> {
    return this.printJobsService.assignOperator(id, req.user!.id, dto.operatorId);
  }

  /** 21.1 (§65): pause a WAITING/QUEUED job. PAUSE_JOBS is a data row in
   * ROLE_PERMISSIONS, held by the production roles (not SHOP_COUNTER). */
  @Post(":id/pause")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.PAUSE_JOBS)
  @ShopScoped("id", PrintJobShopResolver)
  pause(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: PauseJobDto,
  ): Promise<PrintJobResponse> {
    return this.printJobsService.pause(id, req.user!.id, dto.reason);
  }

  /** 21.2 (§66): the operator's failure-reason picker for a FAILED/TIMEOUT job. */
  @Post(":id/failure-reason")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.RECORD_JOB_FAILURE)
  @ShopScoped("id", PrintJobShopResolver)
  recordFailureReason(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: RecordFailureReasonDto,
  ): Promise<PrintJobResponse> {
    return this.printJobsService.recordFailureReason(id, req.user!.id, dto.reason, dto.note);
  }

  /** 21.1 (§65): resume a paused job; re-runs allocation (or honours an
   * explicit printerId) and needs an explicit acknowledgement for a job held
   * by a late PRINTED report. */
  @Post(":id/resume")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.PAUSE_JOBS)
  @ShopScoped("id", PrintJobShopResolver)
  resume(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ResumeJobDto,
  ): Promise<PrintJobResponse> {
    return this.printJobsService.resume(id, req.user!.id, {
      printerId: dto.printerId,
      acknowledgeLatePrint: dto.acknowledgeLatePrint,
    });
  }
}
