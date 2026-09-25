import type { Prisma } from "@prisma/client";

/** 22.2 (PRD 76/122). The automation switches of one shop, read by every
 * AUTOMATIC path. Manual paths (assign, reassign, retry, pause, resume with a
 * named printer) never consult this: manual intervention always stays available.
 *
 * `DEFAULT_SHOP_AUTOMATION` is exactly today's behaviour, and is what a missing
 * settings row yields (the migration and a trigger guarantee a row, so this is only
 * defence in depth). */
export interface ShopAutomation {
  /** dispatch, failover re-allocation, recovery and resume-without-a-printer pick a printer. */
  autoPrinterAssignment: boolean;
  /** Reserved: no automatic operator assignment exists yet, so nothing reads it. */
  autoOperatorAssignment: boolean;
  /** Automatic queue management: recovery of WAITING jobs (printer back, restock). */
  autoQueueManagement: boolean;
  /** The low-stock alert worker raises new alerts. */
  inventoryAlerts: boolean;
  /** Customer order-status notifications are created at all. */
  automaticNotifications: boolean;
  /** Per-printer page limits are enforced in allocation (usage is counted regardless). */
  pageLimitEnforcement: boolean;
  /** shops.auto_failover_enabled (the source of truth stays on `shops`). */
  autoFailover: boolean;
  notificationChannels: { email: boolean; app: boolean };
}

export const DEFAULT_SHOP_AUTOMATION: ShopAutomation = {
  autoPrinterAssignment: true,
  autoOperatorAssignment: false,
  autoQueueManagement: true,
  inventoryAlerts: true,
  automaticNotifications: true,
  pageLimitEnforcement: true,
  autoFailover: false,
  notificationChannels: { email: true, app: true },
};

interface AutomationRow {
  /** null only when the LEFT JOIN found no settings row. */
  auto_printer_assignment_enabled: boolean | null;
  auto_operator_assignment_enabled: boolean;
  auto_queue_management_enabled: boolean;
  inventory_alerts_enabled: boolean;
  automatic_notifications_enabled: boolean;
  page_limit_enforcement_enabled: boolean;
  notification_settings: { emailEnabled?: boolean; appEnabled?: boolean } | null;
  auto_failover_enabled: boolean;
}

type Db = Prisma.TransactionClient;

function fromRow(row: AutomationRow | undefined): ShopAutomation {
  if (!row || row.auto_printer_assignment_enabled === null) {
    return { ...DEFAULT_SHOP_AUTOMATION, autoFailover: row?.auto_failover_enabled ?? false };
  }
  return {
    autoPrinterAssignment: row.auto_printer_assignment_enabled,
    autoOperatorAssignment: row.auto_operator_assignment_enabled,
    autoQueueManagement: row.auto_queue_management_enabled,
    inventoryAlerts: row.inventory_alerts_enabled,
    automaticNotifications: row.automatic_notifications_enabled,
    pageLimitEnforcement: row.page_limit_enforcement_enabled,
    autoFailover: row.auto_failover_enabled,
    notificationChannels: {
      email: row.notification_settings?.emailEnabled !== false,
      app: row.notification_settings?.appEnabled !== false,
    },
  };
}

/** Plain read (no lock): right for a decision that is made once and is legitimately
 * ordered before or after a concurrent settings write (a dispatch, a notification). */
export async function readShopAutomation(db: Db, shopId: string): Promise<ShopAutomation> {
  const rows = await db.$queryRaw<AutomationRow[]>`
    SELECT ss.auto_printer_assignment_enabled, ss.auto_operator_assignment_enabled,
           ss.auto_queue_management_enabled, ss.inventory_alerts_enabled,
           ss.automatic_notifications_enabled, ss.page_limit_enforcement_enabled,
           ss.notification_settings, s.auto_failover_enabled
    FROM shops s LEFT JOIN shop_settings ss ON ss.shop_id = s.id
    WHERE s.id = ${shopId}
  `;
  return fromRow(rows[0]);
}

/** Read under the caller's locks: `shops` FOR SHARE, then `shop_settings` FOR SHARE
 * (the SAME order the settings writer takes them, so a writer and a reader can never
 * deadlock). A settings write racing this either committed first (and is seen) or
 * waits until the caller's transaction ends, so a toggle switched off is never
 * acted against after its commit. Must run inside a transaction. */
export async function readShopAutomationLocked(db: Db, shopId: string): Promise<ShopAutomation> {
  await db.$queryRaw`SELECT id FROM shops WHERE id = ${shopId} FOR SHARE`;
  await db.$queryRaw`SELECT shop_id FROM shop_settings WHERE shop_id = ${shopId} FOR SHARE`;
  return readShopAutomation(db, shopId);
}
