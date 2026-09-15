import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { IdempotencyInterceptor } from "../idempotency/idempotency.interceptor.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";
import { CreateQuoteDto } from "./dto/create-quote.dto.js";
import { OrdersService, type OrderResponse, type QuoteResponse } from "./orders.service.js";

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

  // §92/5.3: idempotent under a client-supplied `Idempotency-Key`
  // header -- a retried "Pay & Place Order" tap after a dropped
  // response replays the first order rather than minting a second one.
  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  createOrder(@Req() req: RequestWithUser, @Body() dto: CreateOrderDto): Promise<OrderResponse> {
    return this.ordersService.createOrder(req.user!.id, dto);
  }

  @Get()
  listOrders(@Req() req: RequestWithUser): Promise<OrderResponse[]> {
    return this.ordersService.listOrders(req.user!.id);
  }

  @Get(":id")
  getOrder(@Req() req: RequestWithUser, @Param("id") id: string): Promise<OrderResponse> {
    return this.ordersService.getOrder(req.user!.id, id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancelOrder(@Req() req: RequestWithUser, @Param("id") id: string): Promise<OrderResponse> {
    return this.ordersService.cancelOrder(req.user!.id, id);
  }
}
