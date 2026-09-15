import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DocumentStatus, type Order, OrderStatus, ShopStatus, type Prisma } from "@prisma/client";
import type { ApiEnv } from "@print-automated/config";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import {
  computeQuote,
  InvalidPageSelectionError,
  type PricingRule,
  type Quote,
} from "@print-automated/pricing";
import { ColorMode, PaperSize, Sides, type PrinterCapabilities } from "@print-automated/types";
import type { CreateQuoteInput } from "@print-automated/validation";
import { API_ENV } from "../config/config.module.js";
import { DocumentsService } from "../documents/documents.service.js";
import { OrderNumberService } from "./order-number.service.js";

export interface QuoteResponse extends Quote {
  documentId: string;
  shopId: string;
}

/** Exactly what 5.5's own Done-when demands survive a later pricing
 * change: the resolved rule's values (not just its id/version, which
 * could be re-read and would then reflect edits made to that same
 * row) and the quote computed from them at creation time. */
export interface PricingSnapshot {
  pricingRuleVersion: number;
  pricingRule: PricingRule;
  quote: Quote;
}

export interface OrderResponse {
  id: string;
  publicOrderNumber: string;
  documentId: string;
  shopId: string;
  printConfiguration: CreateQuoteInput["printConfiguration"];
  pricingSnapshot: PricingSnapshot;
  paymentStatus: Order["paymentStatus"];
  orderStatus: Order["orderStatus"];
  createdAt: Date;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly orderNumberService: OrderNumberService,
    private readonly orderStateMachine: OrderStateMachine,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** §19: "The backend is the authoritative pricing engine." Every
   * input this recomputes from scratch (the document's real page
   * count, the shop's current pricing rule) -- `CreateQuoteInput` has
   * no price field at all for a client to supply in the first place
   * (packages/validation's createQuoteSchema), so there is nothing to
   * ignore, structurally. */
  async createQuote(requestingUserId: string, input: CreateQuoteInput): Promise<QuoteResponse> {
    const { quote } = await this.resolveQuote(requestingUserId, input);
    return { ...quote, documentId: input.documentId, shopId: input.shopId };
  }

  /** §20/5.5's own Done-when: the price is recomputed and snapshotted
   * here, once, at creation -- nothing about an existing order ever
   * re-reads the shop's *current* pricing rule again, so a rule edit
   * made afterward cannot retroactively change what a customer already
   * agreed to pay. The order is minted directly into `UPLOADED` (the
   * document behind it is already `READY`, unlike the enum's `DRAFT`,
   * which no code path here ever produces) via the state machine
   * rather than a raw `create({ orderStatus: ... })`, so the very first
   * status this row ever holds still goes through the same audited,
   * lint-enforced path every later one does. */
  async createOrder(requestingUserId: string, input: CreateQuoteInput): Promise<OrderResponse> {
    const { quote, pricingRuleRow } = await this.resolveQuote(requestingUserId, input);

    const publicOrderNumber = await this.orderNumberService.generate();
    const pricingSnapshot: PricingSnapshot = {
      pricingRuleVersion: pricingRuleRow.version,
      pricingRule: {
        currency: pricingRuleRow.currency,
        pricePerPageMinor: pricingRuleRow.pricePerPageMinor,
        colorSurchargePerPageMinor: pricingRuleRow.colorSurchargePerPageMinor,
        otherCharges: pricingRuleRow.otherCharges as unknown as PricingRule["otherCharges"],
        minimumChargeMinor: pricingRuleRow.minimumChargeMinor,
      },
      quote,
    };

    const order = await this.prisma.order.create({
      data: {
        publicOrderNumber,
        customerId: requestingUserId,
        shopId: input.shopId,
        documentId: input.documentId,
        printConfiguration: input.printConfiguration as unknown as Prisma.InputJsonValue,
        pricingSnapshot: pricingSnapshot as unknown as Prisma.InputJsonValue,
      },
    });

    await this.orderStateMachine.transition(order.id, OrderEvent.CONFIRM_UPLOAD, {
      id: requestingUserId,
    });

    return this.toOrderResponse({ ...order, orderStatus: OrderStatus.UPLOADED });
  }

  async listOrders(requestingUserId: string): Promise<OrderResponse[]> {
    const orders = await this.prisma.order.findMany({
      where: { customerId: requestingUserId },
      orderBy: { createdAt: "desc" },
    });
    return orders.map((order) => this.toOrderResponse(order));
  }

  async getOrder(requestingUserId: string, orderId: string): Promise<OrderResponse> {
    const order = await this.findOwnedOrder(requestingUserId, orderId);
    return this.toOrderResponse(order);
  }

  /** §72/§79. Ownership is checked here, in the service layer (per
   * this codebase's architecture: the state machine itself is generic
   * and has no notion of "customer" at all) -- only then does the
   * illegal-transition check in OrderStateMachine decide whether this
   * particular order's current state actually allows a cancellation. */
  async cancelOrder(requestingUserId: string, orderId: string): Promise<OrderResponse> {
    await this.findOwnedOrder(requestingUserId, orderId);
    await this.orderStateMachine.transition(orderId, OrderEvent.CANCEL, { id: requestingUserId });
    // Re-read rather than trust the pre-transition row -- the
    // transition already committed, and this is the one response
    // field (orderStatus) that call just changed.
    const order = await this.findOwnedOrder(requestingUserId, orderId);
    return this.toOrderResponse(order);
  }

  private async findOwnedOrder(requestingUserId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }
    // 404, not 403, distinguishes "doesn't exist" from "exists but
    // isn't yours" -- documents.service.ts's getStatus draws the same
    // line for the same reason (2.8).
    if (order.customerId !== requestingUserId) {
      throw new ForbiddenException("You do not have access to this order.");
    }
    return order;
  }

  private toOrderResponse(order: Order): OrderResponse {
    return {
      id: order.id,
      publicOrderNumber: order.publicOrderNumber,
      documentId: order.documentId,
      shopId: order.shopId,
      printConfiguration:
        order.printConfiguration as unknown as CreateQuoteInput["printConfiguration"],
      pricingSnapshot: order.pricingSnapshot as unknown as PricingSnapshot,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
    };
  }

  private async resolveQuote(
    requestingUserId: string,
    input: CreateQuoteInput,
  ): Promise<{ quote: Quote; pricingRuleRow: Prisma.PricingRuleGetPayload<object> }> {
    const document = await this.documentsService.getStatus(input.documentId, requestingUserId);
    if (document.status !== DocumentStatus.READY || document.pageCount === null) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "DOCUMENT_NOT_READY",
        "This document is not ready to quote yet.",
        false,
      );
    }

    const shop = await this.prisma.shop.findUnique({ where: { id: input.shopId } });
    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }
    if (shop.status !== ShopStatus.OPEN) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "SHOP_NOT_ACCEPTING_ORDERS",
        "This shop is not currently accepting orders.",
        false,
      );
    }

    const capabilities = shop.capabilities as PrinterCapabilities | null;
    if (!shopCanFulfil(capabilities, input.printConfiguration)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "SHOP_CANNOT_FULFIL_CONFIGURATION",
        "This shop cannot fulfil the requested print configuration.",
        false,
      );
    }

    const pricingRuleRow = await this.prisma.pricingRule.findFirst({
      where: { shopId: shop.id },
      orderBy: { version: "desc" },
    });
    if (!pricingRuleRow) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "SHOP_PRICING_NOT_CONFIGURED",
        "This shop has not set up its pricing yet.",
        false,
      );
    }

    const pricingRule: PricingRule = {
      currency: pricingRuleRow.currency,
      pricePerPageMinor: pricingRuleRow.pricePerPageMinor,
      colorSurchargePerPageMinor: pricingRuleRow.colorSurchargePerPageMinor,
      otherCharges: pricingRuleRow.otherCharges as unknown as PricingRule["otherCharges"],
      minimumChargeMinor: pricingRuleRow.minimumChargeMinor,
    };

    let quote: Quote;
    try {
      quote = computeQuote(
        input.printConfiguration,
        document.pageCount,
        pricingRule,
        this.env.PLATFORM_FEE_MINOR,
      );
    } catch (error) {
      // §4.6's own Done-when: "an out-of-range page selection is
      // blocked client-side AND server-side" -- createQuoteSchema can't
      // statically validate a page range against a specific document's
      // actual page count (that's only known here, at request time), so
      // this is where that check actually happens. Without this catch,
      // an out-of-range range would surface as an opaque 500 via
      // AllExceptionsFilter's fallback branch instead of a real,
      // actionable validation error.
      if (error instanceof InvalidPageSelectionError) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          "INVALID_PAGE_SELECTION",
          error.message,
          false,
        );
      }
      throw error;
    }

    return { quote, pricingRuleRow };
  }
}

/** §18, applied again here (not just at 4.3's discovery filter): a
 * client could still name a shop that doesn't actually support the
 * configuration it's asking to quote (stale UI state, a direct API
 * call, a race with the shop reconfiguring) -- the quote endpoint
 * refuses rather than pricing something the shop can't print. */
function shopCanFulfil(
  capabilities: PrinterCapabilities | null,
  config: CreateQuoteInput["printConfiguration"],
): boolean {
  if (capabilities === null) {
    return false;
  }
  if (config.paperSize === PaperSize.A4 && !capabilities.a4) {
    return false;
  }
  if (config.color === ColorMode.COLOR && !capabilities.color) {
    return false;
  }
  if (config.sides === Sides.DOUBLE && !capabilities.duplex) {
    return false;
  }
  return true;
}
