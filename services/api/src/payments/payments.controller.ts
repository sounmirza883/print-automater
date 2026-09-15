import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { CheckoutDto } from "./dto/checkout.dto.js";
import { PaymentsService, type CheckoutResponse } from "./payments.service.js";

@Controller("payments")
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("checkout")
  checkout(@Req() req: RequestWithUser, @Body() dto: CheckoutDto): Promise<CheckoutResponse> {
    return this.paymentsService.checkout(req.user!.id, dto.orderId);
  }
}
