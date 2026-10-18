import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, Prisma, ShopStaffStatus, UserRole, type Branch } from "@prisma/client";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import { Permission } from "@print-automated/types";
import type {
  CreateBranchInput,
  ListBranchesQueryInput,
  UpdateBranchInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService, type MemberAccess } from "../auth/shop-membership.service.js";

/** Orders that need nothing more from the shop: finished, refused or dead ones, and the
 * customer-side states before an order is submitted (they expire by themselves). Every other state
 * is work the shop still has to do, so its branch cannot be archived underneath it. */
const ORDER_STATUSES_NEEDING_NOTHING: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
  OrderStatus.SHOP_REJECTED,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.DRAFT,
  OrderStatus.UPLOADED,
  OrderStatus.PAYMENT_PENDING,
];

export interface BranchResponse {
  id: string;
  shopId: string;
  name: string;
  city: string | null;
  address: string;
  phone: string | null;
  isOpen: boolean;
  openingHours: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  /** People assigned to this branch (active or suspended; removed people are not counted). */
  staffCount: number;
  /** Active managers assigned to this branch. */
  managers: Array<{ membershipId: string; userId: string; name: string }>;
}

/** A business's physical locations. Every business always has at least one: a migration
 * backfilled them and a trigger creates the first for each new business. The business-level
 * status stays the master gate over every branch; a branch only adds its own open/closed
 * switch. Owners manage branches; a branch's own manager (or an owner) can open or close it. */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  /** Everyone with access to the business sees its branches; a branch-bound person only their own. */
  async list(actorId: string, query: ListBranchesQueryInput): Promise<BranchResponse[]> {
    const access = await this.requireAccess(query.shopId, actorId);
    const branches = await this.prisma.branch.findMany({
      where: {
        shopId: query.shopId,
        ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(access.branchId ? { id: access.branchId } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return this.describe(branches);
  }

  async create(actorId: string, input: CreateBranchInput): Promise<BranchResponse> {
    await this.requireAccess(input.shopId, actorId);
    const branch = await this.writeUnique(() =>
      this.prisma.branch.create({
        data: {
          shopId: input.shopId,
          name: input.name,
          city: input.city ?? null,
          address: input.address,
          phone: input.phone ?? null,
        },
      }),
    );
    await this.audit.record({
      actorId,
      action: AuditAction.BRANCH_CREATED,
      resourceType: "branch",
      resourceId: branch.id,
      metadata: { shopId: branch.shopId, name: branch.name },
    });
    return (await this.describe([branch]))[0]!;
  }

  async update(
    branchId: string,
    input: UpdateBranchInput,
    actorId: string,
  ): Promise<BranchResponse> {
    const existing = await this.requireBranch(branchId);
    await this.requireAccess(existing.shopId, actorId);
    this.assertNotArchived(existing);
    const branch = await this.writeUnique(() =>
      this.prisma.branch.update({
        where: { id: branchId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.openingHours !== undefined
            ? { openingHours: input.openingHours === null ? Prisma.DbNull : input.openingHours }
            : {}),
        },
      }),
    );
    await this.audit.record({
      actorId,
      action: AuditAction.BRANCH_UPDATED,
      resourceType: "branch",
      resourceId: branch.id,
      metadata: {
        shopId: branch.shopId,
        changed: Object.keys(input).filter(
          (key) => input[key as keyof UpdateBranchInput] !== undefined,
        ),
      },
    });
    return (await this.describe([branch]))[0]!;
  }

  /** The owner (business settings access) or this branch's own manager may open or close it. */
  async setOpenState(branchId: string, isOpen: boolean, actorId: string): Promise<BranchResponse> {
    const existing = await this.requireBranch(branchId);
    const access = await this.requireAccess(existing.shopId, actorId);
    const isOwnManager = access.role === UserRole.SHOP_MANAGER && access.branchId === existing.id;
    if (!access.permissions.includes(Permission.MANAGE_SETTINGS) && !isOwnManager) {
      throw new ForbiddenException("Only an owner or this branch's manager can open or close it.");
    }
    this.assertNotArchived(existing);
    const branch = await this.prisma.branch.update({ where: { id: branchId }, data: { isOpen } });
    await this.audit.record({
      actorId,
      action: AuditAction.BRANCH_OPEN_STATE_CHANGED,
      resourceType: "branch",
      resourceId: branch.id,
      metadata: { shopId: branch.shopId, isOpen },
    });
    return (await this.describe([branch]))[0]!;
  }

  /** Archiving keeps the branch's history but takes it out of use. Refused while people still
   * work there, and for the business's last branch. Every branch row of the business is locked
   * first, so two concurrent archives cannot both pass the "not the last one" check. */
  async archive(branchId: string, actorId: string): Promise<BranchResponse> {
    const existing = await this.requireBranch(branchId);
    await this.requireAccess(existing.shopId, actorId);

    const branch = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM branches WHERE shop_id = ${existing.shopId} ORDER BY id FOR UPDATE`;
      const fresh = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
      if (fresh.archivedAt) {
        return fresh;
      }
      const stillInUse = await tx.branch.count({
        where: { shopId: fresh.shopId, archivedAt: null, id: { not: fresh.id } },
      });
      if (stillInUse === 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "LAST_BRANCH",
          "A business must keep at least one branch.",
          false,
        );
      }
      const people = await tx.shopStaff.count({
        where: {
          branchId: fresh.id,
          status: { in: [ShopStaffStatus.ACTIVE, ShopStaffStatus.SUSPENDED] },
        },
      });
      if (people > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "BRANCH_HAS_STAFF",
          "Move or remove the people who work at this branch before archiving it.",
          false,
        );
      }
      // Paired computers and printers belong to a branch (move them to another branch first), and
      // an order that still needs the shop cannot be stranded. New orders and pairings share-lock
      // the branch row, and this transaction holds it FOR UPDATE, so none can slip in unseen.
      const [agents, printers, unfinishedOrders] = await Promise.all([
        tx.printerAgent.count({ where: { branchId: fresh.id } }),
        tx.printer.count({ where: { branchId: fresh.id } }),
        tx.order.count({
          where: { branchId: fresh.id, orderStatus: { notIn: ORDER_STATUSES_NEEDING_NOTHING } },
        }),
      ]);
      if (agents > 0 || printers > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "BRANCH_HAS_PRINTERS",
          "Move this branch's computers and printers to another branch before archiving it.",
          false,
        );
      }
      if (unfinishedOrders > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "BRANCH_HAS_ORDERS",
          "This branch still has orders that need the shop. Archive it once they are finished.",
          false,
        );
      }
      return tx.branch.update({ where: { id: fresh.id }, data: { archivedAt: new Date() } });
    });

    await this.audit.record({
      actorId,
      action: AuditAction.BRANCH_ARCHIVED,
      resourceType: "branch",
      resourceId: branch.id,
      metadata: { shopId: branch.shopId, name: branch.name },
    });
    return (await this.describe([branch]))[0]!;
  }

  private async requireAccess(shopId: string, actorId: string): Promise<MemberAccess> {
    const access = await this.shopMembership.getAccess(shopId, actorId);
    if (!access) {
      throw new ForbiddenException("You do not have access to this business's branches.");
    }
    return access;
  }

  private async requireBranch(branchId: string): Promise<Branch> {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException("No such branch.");
    }
    return branch;
  }

  private assertNotArchived(branch: Branch): void {
    if (branch.archivedAt) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "BRANCH_ARCHIVED",
        "This branch is archived.",
        false,
      );
    }
  }

  /** Two branches of one business cannot share a name. */
  private async writeUnique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppException(
          HttpStatus.CONFLICT,
          "BRANCH_NAME_TAKEN",
          "Another branch of this business already has that name.",
          false,
        );
      }
      throw error;
    }
  }

  private async describe(branches: Branch[]): Promise<BranchResponse[]> {
    const members = await this.prisma.shopStaff.findMany({
      where: {
        branchId: { in: branches.map((branch) => branch.id) },
        status: { not: ShopStaffStatus.REMOVED },
      },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        branchId: true,
        user: { select: { name: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
    });
    return branches.map((branch) => {
      const here = members.filter((member) => member.branchId === branch.id);
      return {
        id: branch.id,
        shopId: branch.shopId,
        name: branch.name,
        city: branch.city,
        address: branch.address,
        phone: branch.phone,
        isOpen: branch.isOpen,
        openingHours: branch.openingHours,
        archivedAt: branch.archivedAt,
        createdAt: branch.createdAt,
        staffCount: here.length,
        managers: here
          .filter(
            (member) =>
              member.role === UserRole.SHOP_MANAGER && member.status === ShopStaffStatus.ACTIVE,
          )
          .map((member) => ({
            membershipId: member.id,
            userId: member.userId,
            name: member.user.name,
          })),
      };
    });
  }
}
