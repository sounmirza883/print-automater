import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { IdempotencyInterceptor } from "../idempotency/idempotency.interceptor.js";
import { RateLimit, type RateLimitOptions } from "../rate-limit/rate-limit.decorator.js";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import { CreateDocumentDto } from "../documents/dto/create-document.dto.js";
import type { CreateDocumentResult, DocumentStatusView } from "../documents/documents.service.js";
import type { OrderResponse } from "../orders/orders.service.js";
import { CreatePublicOrderDto } from "./dto/create-public-order.dto.js";
import { PublicOrdersService, type PublicBranchResponse } from "./public-orders.service.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** 24.1 abuse protection, per route: `perIpAndShop` bounds one client on one
 * shop's QR code (a hammered code throttles that client there, not
 * everywhere); `perIp` bounds the same client across every shop (it cannot
 * dodge the first budget by cycling shop ids). Exported so the e2e suite
 * tests the real numbers. The authenticated upload allows 20/hr per user
 * (DocumentsController); a guest may upload a few files per visit, and the
 * status poll runs every few seconds while the worker scans. */
export const PUBLIC_RATE_LIMITS = {
  createDocument: { perIpAndShop: 30, perIp: 100, windowMs: HOUR_MS },
  confirmUpload: { perIpAndShop: 30, perIp: 100, windowMs: HOUR_MS },
  getDocumentStatus: { perIpAndShop: 60, perIp: 180, windowMs: MINUTE_MS },
  createOrder: { perIpAndShop: 20, perIp: 60, windowMs: HOUR_MS },
  // A PDF render per call, but the guest taps it once or twice per order.
  getInvoice: { perIpAndShop: 30, perIp: 90, windowMs: HOUR_MS },
  // One small read when the QR page opens (and again if the guest refreshes it).
  getBranch: { perIpAndShop: 60, perIp: 180, windowMs: MINUTE_MS },
} as const;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function clientIp(req: Request): string {
  return req.ip ?? "unknown";
}

/** The shop part of a bucket key. The route param is attacker-chosen, so it
 * must not decide how many Redis keys exist: a UUID-shaped id is lower-cased
 * (case variants of one id share a key) and anything else collapses into the
 * single `invalid` key (such a request fails validation anyway). */
function shopKeyPart(req: Request): string {
  const shopId = String(req.params.shopId ?? "").toLowerCase();
  return UUID_SHAPE.test(shopId) ? shopId : "invalid";
}

/** Both buckets for one route. Guards run after routing, so `:shopId` is
 * already on req.params -- and before validation, so a malformed request
 * still spends budget.
 *
 * ORDER MATTERS: RateLimitGuard checks buckets in order and stops at the first
 * refusal, so the per-IP bucket (one key per client) goes FIRST. A client past
 * its IP budget is refused before the per-shop bucket is touched, so cycling
 * shop ids cannot keep minting new per-shop Redis keys. */
export function ipAndShopBuckets(limits: {
  perIpAndShop: number;
  perIp: number;
  windowMs: number;
}): RateLimitOptions[] {
  return [
    {
      limit: limits.perIp,
      windowMs: limits.windowMs,
      keyGenerator: (req) => `ip:${clientIp(req)}`,
    },
    {
      limit: limits.perIpAndShop,
      windowMs: limits.windowMs,
      keyGenerator: (req) => `ip-shop:${clientIp(req)}:${shopKeyPart(req)}`,
    },
  ];
}

/** 24.1 (QR guest ordering): the public, unauthenticated ordering surface
 * a shop's QR code points at. Deliberately NO JwtAuthGuard -- the same
 * precedent as ShopsController's public discovery -- and a brand-new
 * controller, rather than a bypass on the JWT-guarded DocumentsController/
 * OrdersController. The `:shopId` route param alone decides the shop (the
 * QR code's URL encodes it); PublicOrdersService scopes every read and
 * write to it. Every route is rate limited by IP+shop and by IP. */
@Controller("public/shops/:shopId")
@UseGuards(RateLimitGuard)
export class PublicOrdersController {
  constructor(private readonly publicOrdersService: PublicOrdersService) {}

  /** Step 1 of DocumentsController's two-step upload. CreateDocumentDto is
   * reused as-is: the same type/size limits an authenticated upload gets. */
  @Post("documents")
  @RateLimit(ipAndShopBuckets(PUBLIC_RATE_LIMITS.createDocument))
  createDocument(
    @Param("shopId", ParseUUIDPipe) shopId: string,
    @Body() dto: CreateDocumentDto,
  ): Promise<CreateDocumentResult> {
    return this.publicOrdersService.createDocument(shopId, dto);
  }

  /** Step 2: the guest finished the PUT to the presigned URL. */
  @Post("documents/:documentId/upload")
  @HttpCode(HttpStatus.OK)
  @RateLimit(ipAndShopBuckets(PUBLIC_RATE_LIMITS.confirmUpload))
  confirmUpload(
    @Param("shopId", ParseUUIDPipe) shopId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<DocumentStatusView> {
    return this.publicOrdersService.confirmUpload(shopId, documentId);
  }

  /** Polled until the document is READY (scanned, page-counted). */
  @Get("documents/:documentId")
  @RateLimit(ipAndShopBuckets(PUBLIC_RATE_LIMITS.getDocumentStatus))
  getDocumentStatus(
    @Param("shopId", ParseUUIDPipe) shopId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<DocumentStatusView> {
    return this.publicOrdersService.getDocumentStatus(shopId, documentId);
  }

  /** The branch a QR code points at, for the page the guest lands on ("Ordering from ...", or
   * "this branch is closed right now"). Only public fields; 404 for a branch that does not exist,
   * is archived, or belongs to another business. */
  @Get("branches/:branchId")
  @RateLimit(ipAndShopBuckets(PUBLIC_RATE_LIMITS.getBranch))
  getBranch(
    @Param("shopId", ParseUUIDPipe) shopId: string,
    @Param("branchId", ParseUUIDPipe) branchId: string,
  ): Promise<PublicBranchResponse> {
    return this.publicOrdersService.getBranch(shopId, branchId);
  }

  /** §92: idempotent under an `Idempotency-Key` header, like `POST /orders`
   * -- a guest re-tapping "Place order" on a flaky connection replays the
   * first order instead of placing a second one. */
  @Post("orders")
  @RateLimit(ipAndShopBuckets(PUBLIC_RATE_LIMITS.createOrder))
  @UseInterceptors(IdempotencyInterceptor)
  createOrder(
    @Param("shopId", ParseUUIDPipe) shopId: string,
    @Body() dto: CreatePublicOrderDto,
  ): Promise<OrderResponse> {
    return this.publicOrdersService.createOrder(shopId, dto);
  }

  /** The guest's PDF receipt for an order they placed here. Same body and
   * headers as the shop/customer invoice routes, except `attachment`: the
   * confirmation page offers it as a download. */
  @Get("orders/:orderId/invoice")
  @RateLimit(ipAndShopBuckets(PUBLIC_RATE_LIMITS.getInvoice))
  async getInvoice(
    @Param("shopId", ParseUUIDPipe) shopId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.publicOrdersService.getInvoice(shopId, orderId);
    res
      .status(HttpStatus.OK)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(buffer.length),
      })
      .send(buffer);
  }
}
