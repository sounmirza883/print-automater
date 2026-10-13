import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import type {
  BillingPlanOption,
  PaymentInstructionsResponse,
  PaymentProofListResponse,
  PaymentProofResponse,
  PaymentReportResponse,
} from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import {
  AdminListPaymentProofsQueryDto,
  ApprovePaymentProofDto,
  ListShopPaymentProofsQueryDto,
  PaymentReportExportQueryDto,
  PaymentReportQueryDto,
  RejectPaymentProofDto,
  SubmitPaymentProofDto,
  UpdatePaymentInstructionsDto,
} from "./dto/payment-proofs.dto.js";
import { PaymentProofsService, type ProofFile } from "./payment-proofs.service.js";
import { PaymentReportsService, type ReportFile } from "./payment-reports.service.js";

const HOUR_MS = 60 * 60 * 1000;

/** Proof files are private billing documents: never cached, never sniffed. */
function toFileResponse(file: ProofFile, res: Response): StreamableFile {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  return new StreamableFile(file.bytes);
}

function userBucket(request: Request): string {
  return `user:${(request as RequestWithUser).user?.id ?? "anonymous"}`;
}

/** Owner side of manual plan billing: submit proof, see the history and the files.
 * Owner-only: `@ShopScopedField` resolves the role at THIS shop and the service
 * re-checks real ownership. */
@Controller("shop/payment-proofs")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOP_OWNER)
export class PaymentProofsController {
  constructor(private readonly proofs: PaymentProofsService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: HOUR_MS, keyGenerator: userBucket })
  @ShopScopedField("body", "shopId")
  submit(
    @Req() req: RequestWithUser,
    @Body() dto: SubmitPaymentProofDto,
  ): Promise<PaymentProofResponse> {
    return this.proofs.submit(dto, req.user!.id);
  }

  @Get("plans")
  plans(): Promise<{ items: BillingPlanOption[] }> {
    return this.proofs.listPlans();
  }

  @Get()
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListShopPaymentProofsQueryDto,
  ): Promise<PaymentProofResponse[]> {
    return this.proofs.listForShop(query.shopId, req.user!.id);
  }

  @Get(":id/file")
  @ShopScopedField("query", "shopId")
  async file(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListShopPaymentProofsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return toFileResponse(await this.proofs.getFileForShop(query.shopId, id, req.user!.id), res);
  }
}

/** Where owners are told to send their plan payments (platform-wide text). Readable by
 * every shop staff role -- the Billing screen shows it -- and holds nothing sensitive. */
@Controller("shop/payment-instructions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class PaymentInstructionsController {
  constructor(private readonly proofs: PaymentProofsService) {}

  @Get()
  get(): Promise<PaymentInstructionsResponse> {
    return this.proofs.getInstructions();
  }
}

/** Platform-admin side: the review queue, the proof preview, approve/reject, and the
 * instructions editor. No shop scope by design (admin sees every business). */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPaymentProofsController {
  constructor(private readonly proofs: PaymentProofsService) {}

  @Get("payment-proofs")
  list(@Query() query: AdminListPaymentProofsQueryDto): Promise<PaymentProofListResponse> {
    return this.proofs.adminList(query);
  }

  @Get("payment-proofs/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<PaymentProofResponse> {
    return this.proofs.adminGet(id);
  }

  @Get("payment-proofs/:id/file")
  async file(
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return toFileResponse(await this.proofs.adminGetFile(id), res);
  }

  @Post("payment-proofs/:id/approve")
  approve(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApprovePaymentProofDto,
  ): Promise<PaymentProofResponse> {
    return this.proofs.approve(id, req.user!.id, dto);
  }

  @Post("payment-proofs/:id/reject")
  reject(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectPaymentProofDto,
  ): Promise<PaymentProofResponse> {
    return this.proofs.reject(id, req.user!.id, dto);
  }

  @Get("payment-instructions")
  getInstructions(): Promise<PaymentInstructionsResponse> {
    return this.proofs.getInstructions();
  }

  @Put("payment-instructions")
  updateInstructions(
    @Req() req: RequestWithUser,
    @Body() dto: UpdatePaymentInstructionsDto,
  ): Promise<PaymentInstructionsResponse> {
    return this.proofs.updateInstructions(req.user!.id, dto.paymentInstructions);
  }
}

/** Platform-admin payment reports: totals of money received (approved) and not accepted
 * (rejected) over a range, and the same data as a CSV or Excel download. */
@Controller("admin/payment-reports")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPaymentReportsController {
  constructor(private readonly reports: PaymentReportsService) {}

  @Get()
  report(@Query() query: PaymentReportQueryDto): Promise<PaymentReportResponse> {
    return this.reports.report(query);
  }

  @Get("export")
  async export(
    @Req() req: RequestWithUser,
    @Query() query: PaymentReportExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file: ReportFile = await this.reports.export(query, req.user!.id);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    return new StreamableFile(file.bytes);
  }
}
