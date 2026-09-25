import {
  ShopStaffStatus,
  UserStatus,
  type NotificationTargetType,
  type Prisma,
  type StaffNotificationType,
  type UserRole,
} from "@prisma/client";
import type { Permission } from "@print-automated/types";
import { ROLE_PERMISSIONS } from "../auth/role-permissions.js";

/** 23.7 (PRD 37/111): one operational alert for the staff of ONE business, fanned out to
 * every ACTIVE member whose role holds `permission` -- so a low-stock alert reaches the
 * people who can see inventory and a blocked print job reaches the people who can assign
 * jobs, and nobody else (never another business, never the counter for paper alerts).
 *
 * These are OPERATIONAL alerts: none of the shop's customer-notification toggles
 * (`automaticNotifications`, channel switches) apply to them, only the per-feature
 * switches that decide whether the underlying event is raised at all (e.g. the inventory
 * alerts toggle stops the low-stock sweep from raising an alert in the first place). */
export interface StaffAlert {
  shopId: string;
  permission: Permission;
  type: StaffNotificationType;
  title: string;
  body: string;
  targetType: NotificationTargetType;
  targetId: string;
  /** The order the target belongs to, when there is one (offers "open the order"). */
  orderId?: string | null;
  metadata?: Record<string, unknown>;
  /** At most one notification per (recipient, key); omit for events that may repeat. */
  dedupeKey?: string;
}

/** Shop-side roles whose permission set includes `permission` (ADMIN is a platform role,
 * never a shop member). */
export function rolesWithPermission(permission: Permission): UserRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as UserRole[]).filter(
    (role) => role !== "ADMIN" && ROLE_PERMISSIONS[role].includes(permission),
  );
}

/** Inserts the alert for every eligible member; returns how many rows were created. */
export async function notifyShopStaff(
  tx: Prisma.TransactionClient,
  alert: StaffAlert,
): Promise<number> {
  const members = await tx.shopStaff.findMany({
    where: {
      shopId: alert.shopId,
      status: ShopStaffStatus.ACTIVE,
      role: { in: rolesWithPermission(alert.permission) },
      user: { status: UserStatus.ACTIVE },
    },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((member) => member.userId))];
  if (userIds.length === 0) {
    return 0;
  }
  const created = await tx.staffNotification.createMany({
    data: userIds.map((userId) => ({
      userId,
      shopId: alert.shopId,
      type: alert.type,
      title: alert.title,
      body: alert.body,
      targetType: alert.targetType,
      targetId: alert.targetId,
      orderId: alert.orderId ?? null,
      metadata: (alert.metadata ?? {}) as Prisma.InputJsonValue,
      dedupeKey: alert.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/** Same, but a failure here can never abort the caller's transaction: it runs in a
 * SAVEPOINT that is rolled back on error. Use it from inside another write path (a print
 * job transition, the low-stock sweep) where a missing notification must not undo the
 * real work; the alert is then simply not raised (the event itself stays audited). */
export async function notifyShopStaffContained(
  tx: Prisma.TransactionClient,
  alert: StaffAlert,
): Promise<void> {
  await tx.$executeRawUnsafe("SAVEPOINT staff_notification");
  try {
    await notifyShopStaff(tx, alert);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT staff_notification");
  } catch {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT staff_notification");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT staff_notification");
  }
}
