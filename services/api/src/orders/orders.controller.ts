import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { CreateQuoteDto } from "./dto/create-quote.dto.js";
import { OrdersService, type QuoteResponse } from "./orders.service.js";

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // A quote is a computed preview, not a persisted resource -- 200, not
  // NestJS's POST default of 201 Created.
  @Post("quote")
  @HttpCode(HttpStatus.OK)
  createQuote(@Req() req: RequestWithUser, @Body() dto: CreateQuoteDto): Promise<QuoteResponse> {
    return this.ordersService.createQuote(req.user!.id, dto);
  }
}
