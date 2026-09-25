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
  /** 21.1 (§65): pause and resume a print job. */
  PAUSE_JOBS: "PAUSE_JOBS",
  /** 21.2 (§66): pick the failure reason on a failed job. */
  RECORD_JOB_FAILURE: "RECORD_JOB_FAILURE",
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
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
