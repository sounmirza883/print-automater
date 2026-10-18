import { randomBytes, randomUUID } from "node:crypto";
import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { OrderCreationSource, Prisma, ShopStatus, UserRole } from "@prisma/client";
import type { CreateDocumentInput, CreatePublicOrderInput } from "@print-automated/validation";
import {
  AppException,
  AuditService,
  PrismaService,
  redactMetadata,
} from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { PasswordService } from "../auth/password.service.js";
import { maskName, maskPhone } from "../common/mask.js";
import { InvoicesService, type InvoiceResult } from "../invoices/invoices.service.js";
import {
  DocumentsService,
  type CreateDocumentResult,
  type DocumentStatusView,
} from "../documents/documents.service.js";
import { OrdersService, type OrderResponse } from "../orders/orders.service.js";
import { resolveBranchForCustomerOrder } from "../branches/branch-resolution.js";

/** The `.invalid` TLD is reserved (RFC 2606) and never resolves, so mail
 * addressed to a SYSTEM account -- order-lifecycle emails, a password
 * reset -- can never reach anyone. */
const SYSTEM_EMAIL_DOMAIN = "system.print-automated.invalid";

/** What a visitor may know about a branch: where it is, and whether it takes orders right now
 * (the branch's own switch; the business-level status is a separate gate at order time). */
export interface PublicBranchResponse {
  id: string;
  name: string;
  city: string | null;
  address: string;
  isOpen: boolean;
}

interface ShopForQr {
  id: string;
  name: string;
  status: ShopStatus;
  qrSystemUserId: string | null;
}

/** 24.1 (QR guest ordering): the unauthenticated half of ordering. A guest
 * who scanned a shop's QR code has no account, so everything they create is
 * owned by that shop's synthetic SYSTEM user (Shop.qrSystemUserId) -- the
 * same move a counter order makes with the staff member's id (17.5), with a
 * dedicated account instead -- and the guest's own name/phone become a
 * Customer row at the order's customerRecordId.
 *
 * Composes DocumentsService and OrdersService (never a parallel upload or
 * pricing path): the same quote/pricing/state-machine machinery and the same
 * presigned-upload flow the authenticated routes use.
 *
 * Tenant isolation: the route's `:shopId` is the only shop a request can
 * touch. A document is reachable only through the shop whose SYSTEM user
 * owns it; anything else is a 404 (never a 403 that would confirm another
 * shop's document exists). */
@Injectable()
export class PublicOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly ordersService: OrdersService,
    private readonly passwordService: PasswordService,
    private readonly audit: AuditService,
    private readonly invoicesService: InvoicesService,
  ) {}

  /** Step 1 of the upload: a presigned PUT URL, exactly as `POST /documents`.
   * The first QR request a shop ever receives provisions its SYSTEM user. */
  async createDocument(shopId: string, input: CreateDocumentInput): Promise<CreateDocumentResult> {
    const shop = await this.requireOpenShop(shopId);
    const systemUserId = await this.resolveSystemUserId(shop);
    return this.documentsService.create(systemUserId, input);
  }

  /** Step 2 of the upload: the guest's PUT finished; hand it to the worker. */
  async confirmUpload(shopId: string, documentId: string): Promise<DocumentStatusView> {
    const shop = await this.requireOpenShop(shopId);
    const systemUserId = await this.requireQrDocument(shop, documentId);
    return this.documentsService.confirmUpload(documentId, systemUserId);
  }

  /** What the guest's page polls until the worker has scanned and counted
   * the document (an order needs it READY). A read, so it does not require
   * the shop to be OPEN -- only to exist. */
  async getDocumentStatus(shopId: string, documentId: string): Promise<DocumentStatusView> {
    const shop = await this.requireShop(shopId);
    const systemUserId = await this.requireQrDocument(shop, documentId);
    return this.documentsService.getStatus(documentId, systemUserId);
  }

  /** `POST /public/shops/:shopId/orders`. Everything that can refuse the
   * order (shop open, document this shop's and READY, configuration the
   * shop can print, pricing set up, page range valid) is checked BEFORE the
   * guest's Customer row is written -- via the same createQuote the
   * customer-web path uses -- so a refused request leaves nothing behind in
   * the shop's customer list. createOrder re-derives the price itself at
   * creation (§20's snapshot), never trusting the pre-check's quote. */
  async createOrder(shopId: string, input: CreatePublicOrderInput): Promise<OrderResponse> {
    const shop = await this.requireOpenShop(shopId);
    const systemUserId = await this.requireQrDocument(shop, input.documentId);
    const orderInput = {
      shopId: shop.id,
      documentId: input.documentId,
      printConfiguration: input.printConfiguration,
    };
    // The branch whose QR code was scanned (none: the oldest branch). Refused here, before the
    // guest's Customer row exists, when it is closed, archived or not this business's; createOrder
    // checks it again under a lock when the order is written.
    const branch = await resolveBranchForCustomerOrder(this.prisma, {
      shopId: shop.id,
      requested: input.branchId,
    });
    await this.ordersService.createQuote(systemUserId, orderInput);

    const customer = await this.prisma.customer.create({
      data: { shopId: shop.id, name: input.name, phone: input.phone },
      select: { id: true },
    });

    let order: OrderResponse;
    try {
      order = await this.ordersService.createOrder(systemUserId, orderInput, {
        customerRecordId: customer.id,
        creationSource: OrderCreationSource.QR,
        branchId: branch.id,
      });
    } catch (error) {
      // Lost a race with the pre-check (the shop closed, pricing changed):
      // no order references this guest, so do not leave the row behind.
      await this.prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
      throw error;
    }

    await this.audit.record({
      actorId: systemUserId,
      action: AuditAction.QR_ORDER_CREATED,
      resourceType: "order",
      resourceId: order.id,
      metadata: {
        shopId: shop.id,
        branchId: branch.id,
        customerRecordId: customer.id,
        documentId: input.documentId,
        nameMasked: maskName(input.name),
        phoneMasked: maskPhone(input.phone),
      },
    });

    return order;
  }

  /** `GET /public/shops/:shopId/branches/:branchId`: the page behind a branch's QR code. A branch
   * that is unknown, archived or another business's is the same 404, so the route confirms nothing
   * about branches of other businesses. */
  async getBranch(shopId: string, branchId: string): Promise<PublicBranchResponse> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, shopId, archivedAt: null },
      select: { id: true, name: true, city: true, address: true, isOpen: true },
    });
    if (!branch) {
      throw new NotFoundException("Branch not found.");
    }
    return branch;
  }

  /** `GET /public/shops/:shopId/orders/:orderId/invoice`: the guest's PDF
   * receipt for the order they just placed. The order must be a QR order of
   * THIS shop: any other id (another shop's, or an account customer's order)
   * is the same 404 as a missing one, so this route can never read an order a
   * guest did not place. The order id is a random UUID the guest got back
   * from placing the order; a read, so the shop need not be OPEN. */
  async getInvoice(shopId: string, orderId: string): Promise<InvoiceResult> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, shopId, creationSource: OrderCreationSource.QR },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }
    return this.invoicesService.generateForOrder(order.id, null);
  }

  private async requireShop(shopId: string): Promise<ShopForQr> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, status: true, qrSystemUserId: true },
    });
    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }
    return shop;
  }

  /** §107: the same refusal (code and wording) OrdersService gives a
   * customer-web order to a shop that is not accepting them. */
  private async requireOpenShop(shopId: string): Promise<ShopForQr> {
    const shop = await this.requireShop(shopId);
    if (shop.status !== ShopStatus.OPEN) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "SHOP_NOT_ACCEPTING_ORDERS",
        "This shop is not currently accepting orders.",
        false,
      );
    }
    return shop;
  }

  /** The document must be one uploaded through THIS shop's QR code, i.e.
   * owned by this shop's SYSTEM user. Returns that user's id. */
  private async requireQrDocument(shop: ShopForQr, documentId: string): Promise<string> {
    const owned = shop.qrSystemUserId
      ? await this.prisma.document.findFirst({
          where: { id: documentId, ownerUserId: shop.qrSystemUserId },
          select: { id: true },
        })
      : null;
    if (!owned || !shop.qrSystemUserId) {
      throw new NotFoundException("Document not found.");
    }
    return shop.qrSystemUserId;
  }

  /** Lazily provisions the shop's SYSTEM user, exactly once per shop: the
   * shop row is locked (SELECT ... FOR UPDATE) and re-read inside the
   * transaction, so concurrent first requests serialise and all but the
   * first find the id already set. The account can never be signed into:
   * a random 256-bit password nobody ever sees, and a random address on a
   * reserved, undeliverable domain (random, not derived from the shop id,
   * so nobody can pre-register it to block provisioning). */
  private async resolveSystemUserId(shop: ShopForQr): Promise<string> {
    if (shop.qrSystemUserId) {
      return shop.qrSystemUserId;
    }
    // Hashed outside the transaction: argon2id is deliberately slow, and
    // the shop row stays locked only for the few statements below.
    const passwordHash = await this.passwordService.hash(randomBytes(32).toString("base64url"));

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shop.id} FOR UPDATE`;
      const current = await tx.shop.findUniqueOrThrow({
        where: { id: shop.id },
        select: { qrSystemUserId: true },
      });
      if (current.qrSystemUserId) {
        return current.qrSystemUserId;
      }
      const user = await tx.user.create({
        data: {
          role: UserRole.SYSTEM,
          name: `QR orders - ${shop.name}`,
          email: `qr-orders+${randomUUID()}@${SYSTEM_EMAIL_DOMAIN}`,
          passwordHash,
        },
        select: { id: true },
      });
      await tx.shop.update({ where: { id: shop.id }, data: { qrSystemUserId: user.id } });
      // Audited in the SAME transaction as the two writes above (the
      // tx.auditLog.create + redactMetadata pattern every in-transaction
      // audit in this codebase uses; AuditService.record has no tx form), so
      // the account can never exist without its audit row, or vice versa.
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: AuditAction.QR_SYSTEM_USER_PROVISIONED,
          resourceType: "user",
          resourceId: user.id,
          metadata: redactMetadata({ shopId: shop.id }) as Prisma.InputJsonValue,
        },
      });
      return user.id;
    });
  }
}
