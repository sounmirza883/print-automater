import { ForbiddenException, Injectable } from "@nestjs/common";
import type { PricingRule } from "@prisma/client";
import type { Page } from "@print-automated/types";
import type {
  CreatePricingRuleInput,
  ListPricingRulesQueryInput,
} from "@print-automated/validation";
import { AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { listResult, resolvePagination } from "../common/pagination.js";

export interface PricingRuleResponse {
  id: string;
  shopId: string;
  version: number;
  currency: string;
  pricePerPageMinor: number;
  colorSurchargePerPageMinor: number;
  otherCharges: unknown;
  minimumChargeMinor: number;
  paperSizeSurchargePerPageMinor: unknown;
  paperTypeSurchargePerPageMinor: unknown;
  finishingChargeMinor: unknown;
  taxRateBasisPoints: number | null;
  createdAt: Date;
}

/** §19/§20/4.2/17.3: today's ONLY writer of `pricing_rules` outside the
 * seed script. Versioned, append-only -- `create()` NEVER updates an
 * existing row (matching PricingRule's own schema comment and
 * seed.ts's own `upsertPricingRule` reference shape, minus the
 * idempotent-upsert-by-version part, since a real shop repricing is a
 * genuinely new action each time, not a replay of a known version
 * number); the current rule for a shop is always the row with the
 * highest `version`, computed here rather than trusted from any
 * client-supplied value. Because OrdersService.resolveQuote() and
 * createOrder() always read "the current rule" fresh at quote/order-
 * creation time and then snapshot the RESOLVED VALUES (not a live
 * reference) onto the order, a new version created here can never
 * retroactively change an order that already snapshotted an earlier
 * one -- §82's invariant holds structurally, not by convention. */
@Injectable()
export class PricingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  async list(
    requestingUserId: string,
    query: ListPricingRulesQueryInput,
  ): Promise<PricingRuleResponse[] | Page<PricingRuleResponse>> {
    await this.assertMember(query.shopId, requestingUserId);
    const pagination = resolvePagination(query);
    const [rules, total] = await Promise.all([
      this.prisma.pricingRule.findMany({
        where: { shopId: query.shopId },
        orderBy: { version: "desc" },
        take: pagination.take,
        skip: pagination.skip,
      }),
      pagination.paged
        ? this.prisma.pricingRule.count({ where: { shopId: query.shopId } })
        : Promise.resolve(0),
    ]);
    return listResult(
      pagination,
      rules.map((rule) => this.toResponse(rule)),
      total,
    );
  }

  async create(
    requestingUserId: string,
    input: CreatePricingRuleInput,
  ): Promise<PricingRuleResponse> {
    await this.assertMember(input.shopId, requestingUserId);

    const latest = await this.prisma.pricingRule.findFirst({
      where: { shopId: input.shopId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const created = await this.prisma.pricingRule.create({
      data: {
        shopId: input.shopId,
        version: nextVersion,
        currency: input.currency,
        pricePerPageMinor: input.pricePerPageMinor,
        colorSurchargePerPageMinor: input.colorSurchargePerPageMinor,
        otherCharges: input.otherCharges,
        minimumChargeMinor: input.minimumChargeMinor,
        paperSizeSurchargePerPageMinor: input.paperSizeSurchargePerPageMinor,
        paperTypeSurchargePerPageMinor: input.paperTypeSurchargePerPageMinor,
        finishingChargeMinor: input.finishingChargeMinor,
        taxRateBasisPoints: input.taxRateBasisPoints,
      },
    });

    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.PRICING_RULE_CREATED,
      resourceType: "pricing_rule",
      resourceId: created.id,
      metadata: { shopId: created.shopId, version: created.version },
    });

    return this.toResponse(created);
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, userId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's pricing.");
    }
  }

  private toResponse(rule: PricingRule): PricingRuleResponse {
    return {
      id: rule.id,
      shopId: rule.shopId,
      version: rule.version,
      currency: rule.currency,
      pricePerPageMinor: rule.pricePerPageMinor,
      colorSurchargePerPageMinor: rule.colorSurchargePerPageMinor,
      otherCharges: rule.otherCharges,
      minimumChargeMinor: rule.minimumChargeMinor,
      paperSizeSurchargePerPageMinor: rule.paperSizeSurchargePerPageMinor,
      paperTypeSurchargePerPageMinor: rule.paperTypeSurchargePerPageMinor,
      finishingChargeMinor: rule.finishingChargeMinor,
      taxRateBasisPoints: rule.taxRateBasisPoints,
      createdAt: rule.createdAt,
    };
  }
}
