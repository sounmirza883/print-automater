import { ConflictException, Injectable } from "@nestjs/common";
import { ShopStatus, ShopStaffStatus, UserRole, type Prisma, type Shop } from "@prisma/client";
import { PaperSize, type Page, type PrinterCapabilities } from "@print-automated/types";
import type { ListShopsQueryInput, RegisterShopInput } from "@print-automated/validation";
import { PrismaService, AuditService } from "@print-automated/backend-shared";
import { listResult, resolvePagination } from "../common/pagination.js";
import type { AuthResult } from "../auth/auth.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { PasswordService } from "../auth/password.service.js";
import { TokenService } from "../auth/token.service.js";

export interface ShopListItem {
  id: string;
  name: string;
  address: string;
  status: ShopStatus;
  capabilities: PrinterCapabilities | null;
  /** §17 names "distance" and "estimated processing time" as fields a
   * shop can expose, but MVP has no geolocation (§17: "Advanced
   * map/location discovery can follow later") and no real job-backlog
   * data to estimate from (that needs Phase 8's dispatch model) --
   * both are honest `null` placeholders, not fabricated numbers, kept
   * as real (nullable) response fields so a later phase can populate
   * them without an API shape change. */
  distanceKm: number | null;
  estimatedProcessingTimeMinutes: number | null;
}

@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  /** §17/§18: only shops currently able to fulfil the requested
   * configuration, and only shops currently accepting orders at all
   * (§107) -- CLOSED/BUSY/TEMPORARILY_UNAVAILABLE/SUSPENDED are all
   * "cannot currently accept them" states; only OPEN qualifies. */
  async list(query: ListShopsQueryInput): Promise<ShopListItem[] | Page<ShopListItem>> {
    const pagination = resolvePagination(query);
    // A shop with no declared capabilities can't be confirmed to support anything specific,
    // so any requested capability excludes it (a JSON path filter never matches NULL);
    // an unfiltered browse still includes it. The filter runs in SQL so a page is exact.
    const capabilityFilters: Prisma.ShopWhereInput[] = [];
    if (query.paper === PaperSize.A4) {
      capabilityFilters.push({ capabilities: { path: ["a4"], equals: true } });
    }
    if (query.color === true) {
      capabilityFilters.push({ capabilities: { path: ["color"], equals: true } });
    }
    if (query.duplex === true) {
      capabilityFilters.push({ capabilities: { path: ["duplex"], equals: true } });
    }
    const where: Prisma.ShopWhereInput = {
      status: ShopStatus.OPEN,
      ...(capabilityFilters.length > 0 ? { AND: capabilityFilters } : {}),
    };
    const [shops, total] = await Promise.all([
      this.prisma.shop.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: pagination.take,
        skip: pagination.skip,
      }),
      pagination.paged ? this.prisma.shop.count({ where }) : Promise.resolve(0),
    ]);
    return listResult(pagination, shops.map(toShopListItem), total);
  }

  /** Self-service business signup (definition-of-done.md #1): the ONLY
   * way a shop is provisioned outside `prisma/seed.ts` or a direct
   * PrismaClient call. Creates the Shop, its owner's User (role always
   * SHOP_OWNER -- never client-supplied, same §81 reasoning
   * AuthService.register() already applies to CUSTOMER), the ShopStaff
   * link, and version-1 PricingRule all in one transaction, so a
   * failure partway through (e.g. the duplicate-email check racing
   * another request) never leaves an orphaned Shop with no owner. */
  async registerShop(input: RegisterShopInput): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.owner.email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists.");
    }

    const passwordHash = await this.passwordService.hash(input.owner.password);

    const { user, shop } = await this.prisma.$transaction(
      async (tx) => {
        // Re-check inside the transaction: two concurrent registrations
        // for the same email could both pass the outer check.
        const raced = await tx.user.findUnique({ where: { email: input.owner.email } });
        if (raced) {
          throw new ConflictException("An account with this email already exists.");
        }

        const shop = await tx.shop.create({
          data: {
            name: input.shop.name,
            address: input.shop.address,
            phone: input.shop.phone,
            status: ShopStatus.OPEN,
            capabilities: input.shop.capabilities as unknown as Prisma.InputJsonValue,
          },
        });

        const user = await tx.user.create({
          data: {
            role: UserRole.SHOP_OWNER,
            name: input.owner.name,
            email: input.owner.email,
            phone: input.owner.phone,
            passwordHash,
          },
        });

        await tx.shopStaff.create({
          data: {
            shopId: shop.id,
            userId: user.id,
            role: UserRole.SHOP_OWNER,
            status: ShopStaffStatus.ACTIVE,
          },
        });

        await tx.pricingRule.create({
          data: {
            shopId: shop.id,
            version: 1,
            currency: input.pricing.currency,
            pricePerPageMinor: input.pricing.pricePerPageMinor,
            colorSurchargePerPageMinor: input.pricing.colorSurchargePerPageMinor,
            otherCharges: input.pricing.otherCharges,
            minimumChargeMinor: input.pricing.minimumChargeMinor,
            paperSizeSurchargePerPageMinor: input.pricing.paperSizeSurchargePerPageMinor,
            paperTypeSurchargePerPageMinor: input.pricing.paperTypeSurchargePerPageMinor,
            finishingChargeMinor: input.pricing.finishingChargeMinor,
            taxRateBasisPoints: input.pricing.taxRateBasisPoints,
          },
        });

        return { user, shop };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    const pair = await this.tokenService.issueTokenPair(user);
    await this.auditService.record({
      actorId: user.id,
      action: AuditAction.SHOP_REGISTERED,
      resourceType: "shop",
      resourceId: shop.id,
      metadata: { userId: user.id },
    });

    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    };
  }
}

function toShopListItem(shop: Shop): ShopListItem {
  return {
    id: shop.id,
    name: shop.name,
    address: shop.address,
    status: shop.status,
    capabilities: shop.capabilities as PrinterCapabilities | null,
    distanceKm: null,
    estimatedProcessingTimeMinutes: null,
  };
}
