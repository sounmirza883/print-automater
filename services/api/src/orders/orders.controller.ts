import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import type { Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { IdempotencyInterceptor } from "../idempotency/idempotency.interceptor.js";
import { InvoicesService } from "../invoices/invoices.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";
import { CreateQuoteDto } from "./dto/create-quote.dto.js";
import { ListOrdersQueryDto } from "./dto/list-orders-query.dto.js";
import { OrdersService, type OrderResponse, type QuoteResponse } from "./orders.service.js";
import { SearchRateLimitGuard } from "../rate-limit/search-rate-limit.guard.js";

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly invoicesService: InvoicesService,
  ) {}

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
    return this.ordersService.createOrder(req.user!.id, dto, { branchId: dto.branchId });
  }

  @Get()
  @UseGuards(SearchRateLimitGuard)
  listOrders(
    @Req() req: RequestWithUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderResponse[] | Page<OrderResponse>> {
    return this.ordersService.listOrders(req.user!.id, query);
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

  /** §36/17.7: the customer's own order invoice/receipt. Reuses
   * getOwnedOrder()'s exact ownership check (404 for "doesn't exist,"
   * 403 for "exists but isn't yours") rather than inventing a new
   * authorization path for this one endpoint -- the same rule
   * DocumentsService.download() already follows for the same reason. */
  @Get(":id/invoice")
  async downloadInvoice(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.ordersService.getOwnedOrder(req.user!.id, id);
    const { buffer, filename } = await this.invoicesService.generateForOrder(id, req.user!.id);
    res
      .status(HttpStatus.OK)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(buffer.length),
      })
      .send(buffer);
  }
}
