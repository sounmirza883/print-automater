import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Customer, Prisma } from "@prisma/client";
import type { Page } from "@print-automated/types";
import type {
  CreateCustomerInput,
  ListCustomersQueryInput,
  UpdateCustomerInput,
} from "@print-automated/validation";
import { AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { ilike } from "../common/search.js";
import { listResult, resolvePagination } from "../common/pagination.js";

export interface CustomerResponse {
  id: string;
  shopId: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** §33/34/17.4: staff create and search walk-in customers (15.5's
 * `Customer` model, no service/controller until now). `shopId` arrives
 * in the query string (search) or request body (create), never a
 * route param -- membership is checked directly here, the same
 * pattern PrintersService/ProductsService both already establish.
 *
 * Gated by CREATE_ORDERS (create) / VIEW_ORDERS (list/search) /
 * EDIT_ORDERS (update) rather than MANAGE_USERS or MANAGE_PRICES --
 * judgment call: a walk-in Customer record is front-of-house order-
 * intake data (exactly what SHOP_COUNTER's own three permissions
 * already cover, per role-permissions.ts), not staff/user management
 * or shop pricing configuration. SHOP_COUNTER needs to create and
 * search these constantly (17.5's counter-order flow starts here); it
 * would be a real regression if this sub-phase gated customer records
 * behind a permission SHOP_COUNTER doesn't hold. */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  async list(
    requestingUserId: string,
    query: ListCustomersQueryInput,
  ): Promise<CustomerResponse[] | Page<CustomerResponse>> {
    await this.assertMember(query.shopId, requestingUserId);
    const pagination = resolvePagination(query);
    const where: Prisma.CustomerWhereInput = {
      shopId: query.shopId,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q
        ? {
            OR: [
              { name: ilike(query.q) },
              { phone: ilike(query.q) },
              { email: ilike(query.q) },
              { company: ilike(query.q) },
            ],
          }
        : {}),
    };
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: pagination.take,
        skip: pagination.skip,
      }),
      pagination.paged ? this.prisma.customer.count({ where }) : Promise.resolve(0),
    ]);
    return listResult(
      pagination,
      customers.map((customer) => this.toResponse(customer)),
      total,
    );
  }

  async create(requestingUserId: string, input: CreateCustomerInput): Promise<CustomerResponse> {
    await this.assertMember(input.shopId, requestingUserId);
    const customer = await this.prisma.customer.create({
      data: {
        shopId: input.shopId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        company: input.company,
        address: input.address,
      },
    });

    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.CUSTOMER_CREATED,
      resourceType: "customer",
      resourceId: customer.id,
      metadata: { shopId: customer.shopId, name: customer.name },
    });

    return this.toResponse(customer);
  }

  /** ShopScopeGuard (via CustomerShopResolver, at the route level) has
   * already confirmed the caller is active staff at this customer's
   * shop by the time this runs. */
  async update(
    customerId: string,
    input: UpdateCustomerInput,
    actorId: string,
  ): Promise<CustomerResponse> {
    const existing = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!existing) {
      throw new NotFoundException("Customer not found.");
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        company: input.company,
        address: input.address,
        active: input.active,
      },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.CUSTOMER_UPDATED,
      resourceType: "customer",
      resourceId: customerId,
      metadata: { from: { name: existing.name, active: existing.active }, to: input },
    });

    return this.toResponse(updated);
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, userId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's customers.");
    }
  }

  private toResponse(customer: Customer): CustomerResponse {
    return {
      id: customer.id,
      shopId: customer.shopId,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      company: customer.company,
      address: customer.address,
      active: customer.active,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }
}
