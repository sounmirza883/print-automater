import { HttpStatus, Injectable } from "@nestjs/common";
import { NotificationChannel, Prisma, ShopStaffStatus } from "@prisma/client";
import {
  AppException,
  PrismaService,
  rolesWithPermission,
  STAFF_ALERT_PERMISSION,
} from "@print-automated/backend-shared";
import type { StaffNotificationType } from "@prisma/client";
import type { NotificationItem, NotificationTargetKind, Page } from "@print-automated/types";
import type {
  ListNotificationsQueryInput,
  NotificationFilterInput,
} from "@print-automated/validation";

interface FeedRow {
  id: string;
  category: "CUSTOMER_ORDER" | "STAFF_ALERT";
  type: string;
  title: string;
  body: string;
  shopId: string | null;
  targetType: NotificationTargetKind;
  targetId: string;
  orderId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** 23.7 (PRD 111): the notification centre. One merged, user-scoped feed over the two
 * sources a person can have:
 *  - `notifications` (CUSTOMER_ORDER): the order-status notices a customer receives, APP
 *    channel only (the EMAIL rows are the email pipeline's bookkeeping, not inbox items);
 *  - `staff_notifications` (STAFF_ALERT): operational alerts for a business's staff, shown
 *    only while the person is still an ACTIVE member of that business.
 * Every query is keyed by the caller's own user id; a row that is not the caller's is
 * indistinguishable from one that does not exist (404), never a 403 that would confirm it. */
@Injectable()
export class NotificationCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListNotificationsQueryInput): Promise<Page<NotificationItem>> {
    const where = this.filters(query);
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<FeedRow[]>`
        ${this.feed(userId)}
        SELECT * FROM feed ${where}
        ORDER BY "createdAt" DESC, id ASC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `,
      this.prisma.$queryRaw<Array<{ count: number }>>`
        ${this.feed(userId)}
        SELECT count(*)::int AS count FROM feed ${where}
      `,
    ]);
    return {
      items: rows.map(toItem),
      total: totals[0]?.count ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async unreadCount(userId: string, filter: NotificationFilterInput): Promise<{ count: number }> {
    const where = this.filters({ ...filter, unread: true });
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      ${this.feed(userId)}
      SELECT count(*)::int AS count FROM feed ${where}
    `;
    return { count: rows[0]?.count ?? 0 };
  }

  /** Idempotent: an already-read notification keeps its ORIGINAL readAt. */
  async markRead(userId: string, id: string): Promise<NotificationItem> {
    const found = await this.find(userId, id);
    if (!found) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "NOTIFICATION_NOT_FOUND",
        "Notification not found.",
        false,
      );
    }
    if (found.readAt === null) {
      const data = { readAt: new Date() };
      // `readAt: null` in the WHERE makes concurrent calls race-safe: the first wins.
      if (found.category === "CUSTOMER_ORDER") {
        await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data });
      } else {
        await this.prisma.staffNotification.updateMany({
          where: { id, userId, readAt: null },
          data,
        });
      }
    }
    const fresh = await this.find(userId, id);
    return toItem(fresh ?? found);
  }

  /** Marks every notification matching the filter (default: all the caller's) read. Never
   * touches anyone else's, or alerts of a business the caller has left. */
  async markAllRead(userId: string, filter: NotificationFilterInput): Promise<{ updated: number }> {
    const now = new Date();
    let updated = 0;
    if (filter.audience !== "staff" && !filter.shopId) {
      const customer = await this.prisma.notification.updateMany({
        where: { userId, channel: NotificationChannel.APP, readAt: null },
        data: { readAt: now },
      });
      updated += customer.count;
    }
    if (filter.audience !== "customer") {
      const memberships = await this.prisma.shopStaff.findMany({
        where: {
          userId,
          status: ShopStaffStatus.ACTIVE,
          ...(filter.shopId ? { shopId: filter.shopId } : {}),
        },
        select: { shopId: true, role: true },
      });
      // Only alerts the member may STILL see: their current role must hold the permission
      // that entitles them to that kind of alert (same rule as the list).
      const visible = memberships.map((m) => ({
        shopId: m.shopId,
        type: { in: allowedTypes(m.role) },
      }));
      const staff = await this.prisma.staffNotification.updateMany({
        where: { userId, readAt: null, ...(visible.length > 0 ? { OR: visible } : { id: "none" }) },
        data: { readAt: now },
      });
      updated += staff.count;
    }
    return { updated };
  }

  private async find(userId: string, id: string): Promise<FeedRow | undefined> {
    const rows = await this.prisma.$queryRaw<FeedRow[]>`
      ${this.feed(userId)}
      SELECT * FROM feed WHERE id = ${id} LIMIT 1
    `;
    return rows[0];
  }

  /** The merged feed as a CTE prefix, scoped to `userId` (a bound parameter). */
  private feed(userId: string): Prisma.Sql {
    return Prisma.sql`
      WITH feed AS (
        SELECT n.id, 'CUSTOMER_ORDER' AS category, n.type::text AS type,
               COALESCE(n.payload->>'subject', '') AS title,
               COALESCE(n.payload->>'text', '') AS body,
               NULL::text AS "shopId", 'ORDER' AS "targetType", n.order_id AS "targetId",
               n.order_id AS "orderId", n.read_at AS "readAt", n.created_at AS "createdAt"
        FROM notifications n
        WHERE n.user_id = ${userId} AND n.channel = 'APP'::"NotificationChannel"
        UNION ALL
        SELECT s.id, 'STAFF_ALERT', s.type::text, s.title, s.body,
               s.shop_id, s.target_type::text, s.target_id,
               s.order_id, s.read_at, s.created_at
        FROM staff_notifications s
        WHERE s.user_id = ${userId}
          AND EXISTS (
            SELECT 1 FROM shop_staff ss
            WHERE ss.shop_id = s.shop_id AND ss.user_id = s.user_id
              AND ss.status = 'ACTIVE'::"ShopStaffStatus"
              AND (${this.permissionClause()})
          )
      )
    `;
  }

  /** The member's CURRENT role must hold the permission for the alert's type (23.11): an alert
   * raised for an operator stops showing once they are demoted to the counter. */
  private permissionClause(): Prisma.Sql {
    const byPermission = new Map<string, StaffNotificationType[]>();
    for (const [type, permission] of Object.entries(STAFF_ALERT_PERMISSION)) {
      byPermission.set(permission, [
        ...(byPermission.get(permission) ?? []),
        type as StaffNotificationType,
      ]);
    }
    return Prisma.join(
      [...byPermission.entries()].map(
        ([permission, types]) =>
          Prisma.sql`(s.type::text = ANY(${types}::text[]) AND ss.role::text = ANY(${rolesWithPermission(permission as never)}::text[]))`,
      ),
      " OR ",
    );
  }

  private filters(query: NotificationFilterInput & { unread?: boolean }): Prisma.Sql {
    const clauses: Prisma.Sql[] = [];
    if (query.unread === true) clauses.push(Prisma.sql`"readAt" IS NULL`);
    if (query.unread === false) clauses.push(Prisma.sql`"readAt" IS NOT NULL`);
    if (query.shopId) {
      clauses.push(Prisma.sql`category = 'STAFF_ALERT' AND "shopId" = ${query.shopId}`);
    } else if (query.audience === "customer") {
      clauses.push(Prisma.sql`category = 'CUSTOMER_ORDER'`);
    } else if (query.audience === "staff") {
      clauses.push(Prisma.sql`category = 'STAFF_ALERT'`);
    }
    return clauses.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`;
  }
}

/** The alert types a member with this role may see. */
function allowedTypes(role: string): StaffNotificationType[] {
  return (Object.entries(STAFF_ALERT_PERMISSION) as Array<[StaffNotificationType, never]>)
    .filter(([, permission]) => (rolesWithPermission(permission) as string[]).includes(role))
    .map(([type]) => type);
}

function toItem(row: FeedRow): NotificationItem {
  return {
    id: row.id,
    category: row.category,
    type: row.type,
    title: row.title,
    body: row.body,
    shopId: row.shopId,
    target: { type: row.targetType, id: row.targetId, orderId: row.orderId },
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
