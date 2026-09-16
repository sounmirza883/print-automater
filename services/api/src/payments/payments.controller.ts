import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { CheckoutDto } from "./dto/checkout.dto.js";
import { PaymentsService, type CheckoutResponse } from "./payments.service.js";

const HOUR_MS = 60 * 60_000;

// §85's own key: "per user," not per IP -- JwtAuthGuard (class-level,
// so it always runs first) has already populated request.user by the
// time RateLimitGuard's keyGenerator reads it.
function userId(req: Request): string {
  return (req as RequestWithUser).user?.id ?? "unknown";
}

@Controller("payments")
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** §85: "checkout 10/hr per user." */
  @Post("checkout")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: HOUR_MS, keyGenerator: userId })
  checkout(@Req() req: RequestWithUser, @Body() dto: CheckoutDto): Promise<CheckoutResponse> {
    return this.paymentsService.checkout(req.user!.id, dto.orderId);
  }
}
