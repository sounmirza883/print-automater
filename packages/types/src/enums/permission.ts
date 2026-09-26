/** §47 -- the exact catalog PRD §47 lists. Server-side authorization
 * only; the client is never trusted to enforce this (same rule as
 * UserRole, §9). Data, consumed by `ROLE_PERMISSIONS` in
 * packages/backend-shared -- never branched on with `if (role === ...)`
 * scattered through route handlers. */
export const Permission = {
  VIEW_ORDERS: "VIEW_ORDERS",
  CREATE_ORDERS: "CREATE_ORDERS",
  EDIT_ORDERS: "EDIT_ORDERS",
  CANCEL_ORDERS: "CANCEL_ORDERS",
  ASSIGN_JOBS: "ASSIGN_JOBS",
  MANAGE_PRINTERS: "MANAGE_PRINTERS",
  /** 23.14: READ the printer fleet (list and detail) -- what the assign-printer picker and
   * the printer screens need. MANAGE_PRINTERS is write-only (register/update/delete) and does
   * not imply this: ROLE_PERMISSIONS grants both together where both apply. Every shop staff
   * role has it (the counter's change-printer picker has needed it since Phase 17). */
  VIEW_PRINTERS: "VIEW_PRINTERS",
  /** 21.1 (§65): pause and resume a print job. */
  PAUSE_JOBS: "PAUSE_JOBS",
  /** 21.2 (§66): pick the failure reason on a failed job. */
  RECORD_JOB_FAILURE: "RECORD_JOB_FAILURE",
  /** 21.3 (§68): record a quality-check verdict (passed / failed / needs reprint). */
  QUALITY_CHECK: "QUALITY_CHECK",
  /** 21.4 (§67): create a reprint of a printed job. Carries a cost, so it is a
   * manager-level action (plus the printer manager), not an operator one. */
  REPRINT_JOBS: "REPRINT_JOBS",
  /** 21.5 (§71): create and update an order's delivery details and status. Front
   * of house (the counter) handles delivery; reading it needs only VIEW_ORDERS. */
  MANAGE_DELIVERY: "MANAGE_DELIVERY",
  /** 20.2: read stock and movements (operators need to see paper stock;
   * counter staff do not). MANAGE_INVENTORY (change stock) implies it by
   * being granted alongside it in ROLE_PERMISSIONS. */
  VIEW_INVENTORY: "VIEW_INVENTORY",
  MANAGE_INVENTORY: "MANAGE_INVENTORY",
  MANAGE_SUPPLIERS: "MANAGE_SUPPLIERS",
  MANAGE_PRICES: "MANAGE_PRICES",
  VIEW_REPORTS: "VIEW_REPORTS",
  MANAGE_USERS: "MANAGE_USERS",
  MANAGE_SETTINGS: "MANAGE_SETTINGS",
  /** 22.1 (§75): read the business/automation settings and printer rules. */
  VIEW_SETTINGS: "VIEW_SETTINGS",
  /** 22.2/22.3 (§76/§77): change the automation toggles and the printer
   * automation rules. Split from MANAGE_SETTINGS (business details: currency,
   * tax, hours, notification settings, owner-only) because a manager must be able
   * to switch automation off and run the floor by hand (§122), while business-level
   * configuration keeps the 16.3 owner/manager boundary. */
  MANAGE_AUTOMATION: "MANAGE_AUTOMATION",
  /** 23.2 (§39): the business-owner dashboard (revenue, order counts, alerts). Owner
   * and manager only: it carries revenue, which counter staff and operators do not see. */
  VIEW_DASHBOARD: "VIEW_DASHBOARD",
  /** 23.2 (§40): the operator's own production dashboard (my queue, blocked jobs). */
  VIEW_OPERATOR_DASHBOARD: "VIEW_OPERATOR_DASHBOARD",
  /** 23.2 (§41): the per-printer dashboard (status, queue, page allowance). */
  VIEW_PRINTER_DASHBOARD: "VIEW_PRINTER_DASHBOARD",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
