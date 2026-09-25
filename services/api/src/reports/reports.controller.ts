import { Controller, Get, HttpStatus, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { UserRole } from "@prisma/client";
import { Permission, type ReportEnvelope } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { toCsv } from "./csv.js";
import { ReportQueryDto } from "./dto/report-query.dto.js";
import { ReportsService } from "./reports.service.js";

/** 23.5 (PRD 72-74). VIEW_REPORTS (owner and manager; data in ROLE_PERMISSIONS) on every
 * route; the shop is the caller's own (membership is proven in the service). `format=csv`
 * returns the rows as a spreadsheet-safe CSV attachment instead of JSON. */
@Controller("shop/reports")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.VIEW_REPORTS)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private async send<R extends ReportEnvelope<object, unknown>>(
    res: Response,
    query: ReportQueryDto,
    result: Promise<R>,
  ): Promise<void> {
    const report = await result;
    if (query.format === "csv") {
      const day = report.generatedAt.slice(0, 10);
      res
        .status(HttpStatus.OK)
        .set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report.report}-${day}.csv"`,
          "Cache-Control": "no-store",
        })
        .send(toCsv(report.rows as Array<Record<string, unknown>>));
      return;
    }
    res.status(HttpStatus.OK).json(report);
  }

  @Get("orders")
  @ShopScopedField("query", "shopId")
  orders(@Req() req: RequestWithUser, @Query() query: ReportQueryDto, @Res() res: Response) {
    return this.send(res, query, this.reports.orders(req.user!.id, query));
  }

  @Get("revenue")
  @ShopScopedField("query", "shopId")
  revenue(@Req() req: RequestWithUser, @Query() query: ReportQueryDto, @Res() res: Response) {
    return this.send(res, query, this.reports.revenue(req.user!.id, query));
  }

  @Get("printing-volume")
  @ShopScopedField("query", "shopId")
  printingVolume(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    return this.send(res, query, this.reports.printingVolume(req.user!.id, query));
  }

  @Get("printers")
  @ShopScopedField("query", "shopId")
  printers(@Req() req: RequestWithUser, @Query() query: ReportQueryDto, @Res() res: Response) {
    return this.send(res, query, this.reports.printers(req.user!.id, query));
  }

  /** §74: descriptive only (see OperatorWorkloadReportRow). */
  @Get("operator-workload")
  @ShopScopedField("query", "shopId")
  operatorWorkload(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    return this.send(res, query, this.reports.operatorWorkload(req.user!.id, query));
  }

  @Get("paper-consumption")
  @ShopScopedField("query", "shopId")
  paperConsumption(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    return this.send(res, query, this.reports.paperConsumption(req.user!.id, query));
  }

  @Get("supplier-purchases")
  @ShopScopedField("query", "shopId")
  supplierPurchases(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    return this.send(res, query, this.reports.supplierPurchases(req.user!.id, query));
  }
}
