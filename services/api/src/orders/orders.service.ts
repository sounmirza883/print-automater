import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DocumentStatus,
  type Order,
  OrderCreationSource,
  OrderStatus,
  ShopStatus,
  type Prisma,
} from "@prisma/client";
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
import {
  ColorMode,
  PaperSize,
  Sides,
  type Page,
  type PrinterCapabilities,
} from "@print-automated/types";
import type { CreateQuoteInput, ListOrdersQueryInput } from "@print-automated/validation";
import { lockUsableBranch, resolveBranchForCustomerOrder } from "../branches/branch-resolution.js";
import { listResult, resolvePagination } from "../common/pagination.js";
import { ilike } from "../common/search.js";
import { API_ENV } from "../config/config.module.js";
import { DocumentsService } from "../documents/documents.service.js";
import { RefundService } from "../payments/refund.service.js";
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
  // Step 3: the branch the order was placed at (and is produced at).
  branchId: string;
  branchName: string;
  publicOrderNumber: string;
  documentId: string;
  documentFilename: string;
  shopId: string;
  shopName: string;
  printConfiguration: CreateQuoteInput["printConfiguration"];
  pricingSnapshot: PricingSnapshot;
  paymentStatus: Order["paymentStatus"];
  orderStatus: Order["orderStatus"];
  creationSource: Order["creationSource"];
  customerRecordId: string | null;
  createdAt: Date;
}

/** 17.5: extra, counter-order-only fields `createOrder` accepts on top
 * of `CreateQuoteInput` -- kept as a separate parameter rather than
 * folded into `CreateQuoteInput` itself, so the customer-web path
 * (OrdersController's own `POST /orders`) is structurally unable to
 * ever set `customerRecordId`/`creationSource: COUNTER` for itself;
 * only ShopOrdersService's own counter-order method ever passes one. */
export interface CreateOrderExtra {
  customerRecordId?: string;
  creationSource?: OrderCreationSource;
  /** The branch the order goes to. A COUNTER order's has already been decided by the staff rules
   * (ShopOrdersService); for a customer's (web or QR) it is the branch on the code they scanned,
   * and omitting it means the business's oldest branch, so codes printed before branches existed
   * keep working. */
  branchId?: string;
}

/** §28's history list needs the shop's name and the document's
 * filename alongside the order itself -- joined in, not a second
 * round trip per order. `document.filename` survives Phase 11's
 * eventual retention deletion (only `storage_key`/`encrypted_dek` get
 * cleared; the row and its filename are kept precisely so 7.5's own
 * Done-when -- "a past order renders fully after its document has
 * been deleted" -- holds). */
const ORDER_INCLUDE = {
  shop: { select: { name: true } },
  branch: { select: { name: true } },
  document: { select: { filename: true } },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly orderNumberService: OrderNumberService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly refundService: RefundService,
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
  async createOrder(
    requestingUserId: string,
    input: CreateQuoteInput,
    extra?: CreateOrderExtra,
  ): Promise<OrderResponse> {
    const { quote, pricingRuleRow } = await this.resolveQuote(requestingUserId, input);

    const publicOrderNumber = await this.orderNumberService.generate();
    const pricingSnapshot: PricingSnapshot = {
      pricingRuleVersion: pricingRuleRow.version,
      pricingRule: toPricingRule(pricingRuleRow),
      quote,
    };

    // Step 3: the branch is decided and share-locked in the same transaction that writes the
    // order, so a branch archived a moment ago cannot receive it. A counter order's branch was
    // already chosen by the staff rules (it may be a closed branch: the counter is staffed); a
    // customer's is the one on the code they scanned (closed or archived refuses the order).
    const order = await this.prisma.$transaction(async (tx) => {
      const branch =
        extra?.creationSource === OrderCreationSource.COUNTER && extra.branchId !== undefined
          ? await lockUsableBranch(tx, input.shopId, extra.branchId)
          : await resolveBranchForCustomerOrder(tx, {
              shopId: input.shopId,
              requested: extra?.branchId,
            });
      return tx.order.create({
        data: {
          publicOrderNumber,
          customerId: requestingUserId,
          // 17.5: undefined (never null) for a self-service order --
          // Prisma treats an undefined field as "not provided," so this
          // stays out of the INSERT entirely rather than writing an
          // explicit NULL, identical to every pre-17.5 createOrder() call.
          customerRecordId: extra?.customerRecordId,
          creationSource: extra?.creationSource ?? OrderCreationSource.CUSTOMER_WEB,
          shopId: input.shopId,
          branchId: branch.id,
          documentId: input.documentId,
          printConfiguration: input.printConfiguration as unknown as Prisma.InputJsonValue,
          pricingSnapshot: pricingSnapshot as unknown as Prisma.InputJsonValue,
        },
        include: ORDER_INCLUDE,
      });
    });

    await this.orderStateMachine.transition(order.id, OrderEvent.CONFIRM_UPLOAD, {
      id: requestingUserId,
    });

    return this.toOrderResponse({ ...order, orderStatus: OrderStatus.UPLOADED });
  }

  /** Code review finding (17.6-17.7 review): a COUNTER order
   * (17.5) sets `customerId` to the STAFF member who rang it up, not a
   * synthetic account -- see this file's own createOrder() comment for
   * why. That's correct for lifecycle emails and ownership plumbing,
   * but it means a staff member who has ever placed a walk-in order at
   * the counter also technically "owns" that order by customerId, and
   * without this filter every one of those would appear mixed into
   * their own personal "my orders" history here -- a real information/
   * UX conflation (not a security leak; they legitimately created
   * those rows) between "orders I placed for myself" and "orders I
   * rang up for someone else." This is specifically the self-service
   * "my orders" view (§72/§79), so it excludes COUNTER-sourced orders;
   * shop staff see those through GET /shop/orders instead, where
   * they're correctly attributed to the walk-in customerRecord. */
  async listOrders(
    requestingUserId: string,
    query: ListOrdersQueryInput = {},
  ): Promise<OrderResponse[] | Page<OrderResponse>> {
    const pagination = resolvePagination(query);
    const where: Prisma.OrderWhereInput = {
      customerId: requestingUserId,
      creationSource: OrderCreationSource.CUSTOMER_WEB,
      ...(query.status ? { orderStatus: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { publicOrderNumber: ilike(query.q) },
              { document: { filename: ilike(query.q) } },
              { items: { some: { document: { filename: ilike(query.q) } } } },
            ],
          }
        : {}),
    };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: ORDER_INCLUDE,
        take: pagination.take,
        skip: pagination.skip,
      }),
      pagination.paged ? this.prisma.order.count({ where }) : Promise.resolve(0),
    ]);
    return listResult(
      pagination,
      orders.map((order) => this.toOrderResponse(order)),
      total,
    );
  }

  async getOrder(requestingUserId: string, orderId: string): Promise<OrderResponse> {
    const order = await this.getOwnedOrder(requestingUserId, orderId);
    return this.toOrderResponse(order);
  }

  /** §72/§79. Ownership is checked here, in the service layer (per
   * this codebase's architecture: the state machine itself is generic
   * and has no notion of "customer" at all) -- only then does the
   * illegal-transition check in OrderStateMachine decide whether this
   * particular order's current state actually allows a cancellation.
   *
   * §80/11.3: "permitted cancellation... trigger[s] refunds where
   * payment already succeeded." CANCEL is legal from two states
   * (order-state-machine.ts): PAYMENT_PENDING, where nothing has been
   * paid yet, and WAITING_FOR_SHOP, which is only reachable once
   * payment genuinely succeeded -- unlike rejectOrder's own trigger,
   * this one is NOT unconditional, which is exactly why
   * refundOrderIfPaid() checks `paymentStatus` itself rather than the
   * caller assuming. */
  async cancelOrder(requestingUserId: string, orderId: string): Promise<OrderResponse> {
    await this.getOwnedOrder(requestingUserId, orderId);
    await this.orderStateMachine.transition(orderId, OrderEvent.CANCEL, { id: requestingUserId });
    await this.refundService.refundOrderIfPaid(orderId, "customer_cancellation", requestingUserId);
    // Re-read rather than trust the pre-transition row -- the
    // transition already committed, and this is the one response
    // field (orderStatus) that call just changed.
    const order = await this.getOwnedOrder(requestingUserId, orderId);
    return this.toOrderResponse(order);
  }

  /** Public -- 6.4's PaymentsService reuses this rather than
   * duplicating the same 404-vs-403 ownership check against the same
   * table for the same reason. Always includes shop/document (a small,
   * fixed extra join) rather than a second, leaner variant just for
   * PaymentsService's own narrower needs -- one query shape for "the
   * order this requester owns," not two that could quietly drift. */
  async getOwnedOrder(requestingUserId: string, orderId: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
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

  private toOrderResponse(order: OrderWithRelations): OrderResponse {
    return {
      id: order.id,
      branchId: order.branchId,
      branchName: order.branch.name,
      publicOrderNumber: order.publicOrderNumber,
      documentId: order.documentId,
      documentFilename: order.document.filename,
      shopId: order.shopId,
      shopName: order.shop.name,
      printConfiguration:
        order.printConfiguration as unknown as CreateQuoteInput["printConfiguration"],
      pricingSnapshot: order.pricingSnapshot as unknown as PricingSnapshot,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      creationSource: order.creationSource,
      customerRecordId: order.customerRecordId,
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

    const pricingRule = toPricingRule(pricingRuleRow);

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

/** 17.2/17.3: maps a persisted `pricing_rules` row onto
 * packages/pricing's own `PricingRule` input shape, INCLUDING the v2
 * fields (paper size/type surcharges, finishing charges, tax) -- used
 * both to build the object `computeQuote()` actually reads and to
 * snapshot onto a new order's `pricingSnapshot.pricingRule`. A single
 * function, not duplicated inline at each of those two call sites, so
 * they can never quietly drift out of sync (e.g. one remembering the
 * new v2 fields, the other forgetting them, silently pricing/
 * snapshotting differently for the same rule). */
function toPricingRule(row: Prisma.PricingRuleGetPayload<object>): PricingRule {
  return {
    currency: row.currency,
    pricePerPageMinor: row.pricePerPageMinor,
    colorSurchargePerPageMinor: row.colorSurchargePerPageMinor,
    otherCharges: row.otherCharges as unknown as PricingRule["otherCharges"],
    minimumChargeMinor: row.minimumChargeMinor,
    paperSizeSurchargePerPageMinor:
      row.paperSizeSurchargePerPageMinor as unknown as PricingRule["paperSizeSurchargePerPageMinor"],
    paperTypeSurchargePerPageMinor:
      row.paperTypeSurchargePerPageMinor as unknown as PricingRule["paperTypeSurchargePerPageMinor"],
    finishingChargeMinor:
      row.finishingChargeMinor as unknown as PricingRule["finishingChargeMinor"],
    taxRateBasisPoints: row.taxRateBasisPoints ?? undefined,
  };
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
