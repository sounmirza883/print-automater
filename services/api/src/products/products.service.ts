import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Product } from "@prisma/client";
import type {
  ProductPaperRequirementsInput,
  PrinterCapabilitiesInput,
} from "@print-automated/validation";
import type { CreateProductInput, UpdateProductInput } from "@print-automated/validation";
import { AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

export interface ProductResponse {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  taxRateBasisPoints: number | null;
  printerRequirements: PrinterCapabilitiesInput | null;
  paperRequirements: ProductPaperRequirementsInput | null;
  available: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** §13/17.3: a shop's own named product catalog. `shopId` arrives in
 * the query string (list) or request body (create), never a route
 * param -- so, like PrintersService's own list/register, membership is
 * checked directly here rather than via ShopScopeGuard's resolver
 * mechanism. Gated by MANAGE_PRICES at the controller (§47) -- the
 * same permission that gates pricing-rule versions, since a product's
 * own fields (tax config, printer/paper requirements) are pricing/
 * catalog configuration in the same sense a PricingRule is. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  async list(requestingUserId: string, shopId: string): Promise<ProductResponse[]> {
    await this.assertMember(shopId, requestingUserId);
    const products = await this.prisma.product.findMany({
      where: { shopId },
      orderBy: { createdAt: "asc" },
    });
    return products.map((product) => this.toResponse(product));
  }

  async create(requestingUserId: string, input: CreateProductInput): Promise<ProductResponse> {
    await this.assertMember(input.shopId, requestingUserId);
    const product = await this.prisma.product.create({
      data: {
        shopId: input.shopId,
        name: input.name,
        description: input.description,
        category: input.category,
        unit: input.unit,
        taxRateBasisPoints: input.taxRateBasisPoints,
        printerRequirements: input.printerRequirements as unknown as
          Prisma.InputJsonValue | undefined,
        paperRequirements: input.paperRequirements as unknown as Prisma.InputJsonValue | undefined,
        ...(input.available === undefined ? {} : { available: input.available }),
      },
    });

    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.PRODUCT_CREATED,
      resourceType: "product",
      resourceId: product.id,
      metadata: { shopId: product.shopId, name: product.name },
    });

    return this.toResponse(product);
  }

  /** ShopScopeGuard (via ProductShopResolver, at the route level) has
   * already confirmed the caller is active staff at this product's
   * shop by the time this runs -- the same pattern PrintersService's
   * own update() follows. */
  async update(
    productId: string,
    input: UpdateProductInput,
    actorId: string,
  ): Promise<ProductResponse> {
    const existing = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      throw new NotFoundException("Product not found.");
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        unit: input.unit,
        taxRateBasisPoints: input.taxRateBasisPoints,
        printerRequirements: input.printerRequirements as unknown as
          Prisma.InputJsonValue | undefined,
        paperRequirements: input.paperRequirements as unknown as Prisma.InputJsonValue | undefined,
        available: input.available,
      },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.PRODUCT_UPDATED,
      resourceType: "product",
      resourceId: productId,
      metadata: { from: { name: existing.name, available: existing.available }, to: input },
    });

    return this.toResponse(updated);
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, userId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's products.");
    }
  }

  private toResponse(product: Product): ProductResponse {
    return {
      id: product.id,
      shopId: product.shopId,
      name: product.name,
      description: product.description,
      category: product.category,
      unit: product.unit,
      taxRateBasisPoints: product.taxRateBasisPoints,
      printerRequirements:
        product.printerRequirements as unknown as PrinterCapabilitiesInput | null,
      paperRequirements:
        product.paperRequirements as unknown as ProductPaperRequirementsInput | null,
      available: product.available,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
