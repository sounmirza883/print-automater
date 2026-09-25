import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type Supplier, type SupplierProduct, type SupplierStatus } from "@prisma/client";
import type {
  CreateSupplierInput,
  LinkSupplierProductInput,
  ListSuppliersQueryInput,
  UpdateSupplierInput,
  UpdateSupplierProductInput,
} from "@print-automated/validation";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import type { Page } from "../inventory/inventory.service.js";

export interface SupplierResponse {
  id: string;
  shopId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTerms: string | null;
  status: SupplierStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierProductResponse {
  id: string;
  shopId: string;
  supplierId: string;
  supplierName: string;
  inventoryItemId: string;
  itemName: string;
  supplierSku: string | null;
  unitPriceMinor: number | null;
  leadTimeDays: number | null;
  active: boolean;
}

type LinkWithNames = SupplierProduct & {
  supplier: { name: string };
  item: { name: string };
};

function toSupplier(row: Supplier): SupplierResponse {
  return {
    id: row.id,
    shopId: row.shopId,
    name: row.name,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    paymentTerms: row.paymentTerms,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLink(row: LinkWithNames): SupplierProductResponse {
  return {
    id: row.id,
    shopId: row.shopId,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    inventoryItemId: row.inventoryItemId,
    itemName: row.item.name,
    supplierSku: row.supplierSku,
    unitPriceMinor: row.unitPriceMinor,
    leadTimeDays: row.leadTimeDays,
    active: row.active,
  };
}

const LINK_INCLUDE = {
  supplier: { select: { name: true } },
  item: { select: { name: true } },
} as const;

/** 29/30/20.6. `shopId` routes (list/create) check membership here; `:id`
 * routes run behind ShopScopeGuard. Every query carries the shop, and the
 * database composite foreign keys back that up for links. */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: ListSuppliersQueryInput): Promise<Page<SupplierResponse>> {
    await this.assertMember(query.shopId, userId);
    const where: Prisma.SupplierWhereInput = { shopId: query.shopId };
    if (query.status) where.status = query.status;
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return { items: rows.map(toSupplier), total, limit: query.limit, offset: query.offset };
  }

  async create(userId: string, input: CreateSupplierInput): Promise<SupplierResponse> {
    await this.assertMember(input.shopId, userId);
    const created = await this.prisma.supplier.create({ data: input });
    await this.audit.record({
      actorId: userId,
      action: AuditAction.SUPPLIER_CREATED,
      resourceType: "supplier",
      resourceId: created.id,
      metadata: { shopId: created.shopId, name: created.name },
    });
    return toSupplier(created);
  }

  async get(id: string): Promise<SupplierResponse> {
    return toSupplier(await this.require(id));
  }

  async update(id: string, input: UpdateSupplierInput, actorId: string): Promise<SupplierResponse> {
    const existing = await this.require(id);
    const updated = await this.prisma.supplier.update({ where: { id }, data: input });
    await this.audit.record({
      actorId,
      action: AuditAction.SUPPLIER_UPDATED,
      resourceType: "supplier",
      resourceId: id,
      metadata: { shopId: existing.shopId, changes: input },
    });
    return toSupplier(updated);
  }

  async listProducts(
    supplierId: string,
    query: { limit: number; offset: number },
  ): Promise<Page<SupplierProductResponse>> {
    return this.pageLinks({ supplierId }, query);
  }

  async listSuppliersOfItem(
    itemId: string,
    query: { limit: number; offset: number },
  ): Promise<Page<SupplierProductResponse>> {
    return this.pageLinks({ inventoryItemId: itemId }, query);
  }

  async link(
    supplierId: string,
    input: LinkSupplierProductInput,
    actorId: string,
  ): Promise<SupplierProductResponse> {
    const supplier = await this.require(supplierId);
    // The item must be in the SAME shop as the supplier (the composite FK is the
    // backstop; this gives a clean 404 instead of a constraint error).
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, shopId: supplier.shopId },
      select: { id: true },
    });
    if (!item) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "INVENTORY_ITEM_NOT_FOUND",
        "Inventory item not found.",
        false,
      );
    }
    try {
      const created = await this.prisma.supplierProduct.create({
        data: {
          shopId: supplier.shopId,
          supplierId,
          inventoryItemId: input.inventoryItemId,
          supplierSku: input.supplierSku,
          unitPriceMinor: input.unitPriceMinor,
          leadTimeDays: input.leadTimeDays,
        },
        include: LINK_INCLUDE,
      });
      await this.audit.record({
        actorId,
        action: AuditAction.SUPPLIER_PRODUCT_LINKED,
        resourceType: "supplier",
        resourceId: supplierId,
        metadata: { shopId: supplier.shopId, inventoryItemId: input.inventoryItemId },
      });
      return toLink(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppException(
          HttpStatus.CONFLICT,
          "SUPPLIER_PRODUCT_EXISTS",
          "This supplier already supplies that item.",
          false,
        );
      }
      throw error;
    }
  }

  async updateLink(
    linkId: string,
    input: UpdateSupplierProductInput,
    actorId: string,
  ): Promise<SupplierProductResponse> {
    const existing = await this.requireLink(linkId);
    const updated = await this.prisma.supplierProduct.update({
      where: { id: linkId },
      data: input,
      include: LINK_INCLUDE,
    });
    await this.audit.record({
      actorId,
      action: AuditAction.SUPPLIER_PRODUCT_UPDATED,
      resourceType: "supplier",
      resourceId: existing.supplierId,
      metadata: { shopId: existing.shopId, linkId, changes: input },
    });
    return toLink(updated);
  }

  async unlink(linkId: string, actorId: string): Promise<void> {
    const existing = await this.requireLink(linkId);
    await this.prisma.supplierProduct.delete({ where: { id: linkId } });
    await this.audit.record({
      actorId,
      action: AuditAction.SUPPLIER_PRODUCT_UNLINKED,
      resourceType: "supplier",
      resourceId: existing.supplierId,
      metadata: { shopId: existing.shopId, inventoryItemId: existing.inventoryItemId },
    });
  }

  private async pageLinks(
    where: Prisma.SupplierProductWhereInput,
    query: { limit: number; offset: number },
  ): Promise<Page<SupplierProductResponse>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplierProduct.count({ where }),
      this.prisma.supplierProduct.findMany({
        where,
        include: LINK_INCLUDE,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return { items: rows.map(toLink), total, limit: query.limit, offset: query.offset };
  }

  private async require(id: string): Promise<Supplier> {
    const row = await this.prisma.supplier.findUnique({ where: { id } });
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "SUPPLIER_NOT_FOUND",
        "Supplier not found.",
        false,
      );
    }
    return row;
  }

  private async requireLink(id: string): Promise<SupplierProduct> {
    const row = await this.prisma.supplierProduct.findUnique({ where: { id } });
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "SUPPLIER_PRODUCT_NOT_FOUND",
        "Supplier product link not found.",
        false,
      );
    }
    return row;
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's suppliers.");
    }
  }
}
