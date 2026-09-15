import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentStatus, ShopStatus } from "@prisma/client";
import type { ApiEnv } from "@print-automated/config";
import { PrismaService } from "@print-automated/backend-shared";
import { computeQuote, type PricingRule, type Quote } from "@print-automated/pricing";
import { ColorMode, PaperSize, Sides, type PrinterCapabilities } from "@print-automated/types";
import type { CreateQuoteInput } from "@print-automated/validation";
import { API_ENV } from "../config/config.module.js";
import { AppException } from "../common/errors/app-exception.js";
import { DocumentsService } from "../documents/documents.service.js";

export interface QuoteResponse extends Quote {
  documentId: string;
  shopId: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** §19: "The backend is the authoritative pricing engine." Every
   * input this recomputes from scratch (the document's real page
   * count, the shop's current pricing rule) -- `CreateQuoteInput` has
   * no price field at all for a client to supply in the first place
   * (packages/validation's createQuoteSchema), so there is nothing to
   * ignore, structurally. */
  async createQuote(requestingUserId: string, input: CreateQuoteInput): Promise<QuoteResponse> {
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

    const quote = computeQuote(
      input.printConfiguration,
      document.pageCount,
      pricingRule,
      this.env.PLATFORM_FEE_MINOR,
    );

    return { ...quote, documentId: input.documentId, shopId: input.shopId };
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
