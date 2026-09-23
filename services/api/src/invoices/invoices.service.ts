import { Injectable, NotFoundException } from "@nestjs/common";
import type { Quote } from "@print-automated/pricing";
import { AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import type { PricingSnapshot } from "../orders/orders.service.js";
import { buildInvoicePdf } from "./build-invoice-pdf.js";

export interface InvoiceResult {
  buffer: Buffer;
  filename: string;
}

/** §36/17.7: renders a PDF invoice from an order's OWN stored
 * `pricingSnapshot` -- never a live re-price (§82's own invariant;
 * this service reads no PricingRule row at all). Authorization is
 * deliberately NOT this service's job: both callers (OrdersController's
 * own customer-ownership check via OrdersService.getOwnedOrder, and
 * ShopOrdersController's own ShopScopeGuard/OrderShopResolver) already
 * have a complete, existing access-control mechanism for "may this
 * caller see this order" -- reusing those, rather than this service
 * inventing a third one, is 17.7's own explicit Done-when. */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async generateForOrder(orderId: string, actorId: string | null): Promise<InvoiceResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shop: { select: { name: true } },
        document: { select: { filename: true } },
        customerRecord: { select: { name: true } },
        customer: { select: { name: true } },
      },
    });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    const quote = (order.pricingSnapshot as unknown as PricingSnapshot).quote as Quote;

    const buffer = await buildInvoicePdf({
      publicOrderNumber: order.publicOrderNumber,
      shopName: order.shop.name,
      // 17.5: prefers the walk-in customer's real name over the staff
      // account customerId points at for a COUNTER order -- same
      // reasoning ShopOrdersService's own toResponse() already applies.
      customerName: order.customerRecord?.name ?? order.customer.name,
      documentFilename: order.document.filename,
      createdAt: order.createdAt,
      quote,
    });

    await this.audit.record({
      actorId,
      action: AuditAction.INVOICE_DOWNLOADED,
      resourceType: "order",
      resourceId: orderId,
    });

    return { buffer, filename: `invoice-${order.publicOrderNumber}.pdf` };
  }
}
