import { Permission } from "@print-automated/types";

/** The Edit panel's checklist: every permission once, under a plain heading, in words a shop
 * owner uses. Which permissions a ROLE holds by default is never copied here: the API sends
 * each person's `defaultPermissions`, so this file only decides how they are presented. */
export interface PermissionLine {
  permission: Permission;
  label: string;
  hint?: string;
}

export interface PermissionGroup {
  title: string;
  items: PermissionLine[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    title: "Orders",
    items: [
      { permission: Permission.VIEW_ORDERS, label: "See orders" },
      { permission: Permission.CREATE_ORDERS, label: "Create counter orders" },
      { permission: Permission.EDIT_ORDERS, label: "Edit orders" },
      { permission: Permission.CANCEL_ORDERS, label: "Cancel orders" },
      {
        permission: Permission.MANAGE_DELIVERY,
        label: "Manage deliveries",
        hint: "Also shows customers' addresses and contact details.",
      },
    ],
  },
  {
    title: "Production and print jobs",
    items: [
      { permission: Permission.ASSIGN_JOBS, label: "Assign jobs to printers and operators" },
      { permission: Permission.PAUSE_JOBS, label: "Pause and resume jobs" },
      { permission: Permission.RECORD_JOB_FAILURE, label: "Record why a job failed" },
      { permission: Permission.QUALITY_CHECK, label: "Quality-check printed jobs" },
      { permission: Permission.REPRINT_JOBS, label: "Reprint jobs", hint: "Reprints cost paper." },
    ],
  },
  {
    title: "Printers",
    items: [
      { permission: Permission.VIEW_PRINTERS, label: "See printers" },
      {
        permission: Permission.MANAGE_PRINTERS,
        label: "Add, change and remove printers, and pair PCs",
      },
    ],
  },
  {
    title: "Stock and suppliers",
    items: [
      { permission: Permission.VIEW_INVENTORY, label: "See paper stock" },
      { permission: Permission.MANAGE_INVENTORY, label: "Change stock and raise purchase orders" },
      { permission: Permission.MANAGE_SUPPLIERS, label: "Manage suppliers" },
    ],
  },
  {
    title: "Catalogue and prices",
    items: [{ permission: Permission.MANAGE_PRICES, label: "Change products and prices" }],
  },
  {
    title: "Reports and dashboards",
    items: [
      { permission: Permission.VIEW_REPORTS, label: "See reports" },
      {
        permission: Permission.VIEW_DASHBOARD,
        label: "See the business dashboard",
        hint: "Shows revenue.",
      },
      { permission: Permission.VIEW_OPERATOR_DASHBOARD, label: "See the operator dashboard" },
      { permission: Permission.VIEW_PRINTER_DASHBOARD, label: "See the printer dashboard" },
    ],
  },
  {
    title: "Staff",
    items: [
      {
        permission: Permission.MANAGE_USERS,
        label: "Manage staff and their access",
        hint: "Invite people, change roles and edit access.",
      },
      { permission: Permission.VIEW_STAFF_DIRECTORY, label: "See the staff name list" },
    ],
  },
  {
    title: "Settings",
    items: [
      { permission: Permission.VIEW_SETTINGS, label: "See business settings" },
      { permission: Permission.MANAGE_AUTOMATION, label: "Change automation settings" },
      {
        permission: Permission.MANAGE_SETTINGS,
        label: "Change business details and billing",
        hint: "Owner only.",
      },
    ],
  },
];

/** Mirrors the API's manage-implies-view table: [permission, the read permission it needs]. */
const IMPLIES: ReadonlyArray<readonly [Permission, Permission]> = [
  [Permission.MANAGE_INVENTORY, Permission.VIEW_INVENTORY],
  [Permission.MANAGE_PRINTERS, Permission.VIEW_PRINTERS],
  [Permission.MANAGE_AUTOMATION, Permission.VIEW_SETTINGS],
  [Permission.CREATE_ORDERS, Permission.VIEW_ORDERS],
  [Permission.EDIT_ORDERS, Permission.VIEW_ORDERS],
  [Permission.CANCEL_ORDERS, Permission.VIEW_ORDERS],
];

/** Business details and billing: never held by anyone but an owner (the API refuses it too). */
const OWNER_ONLY: readonly Permission[] = [Permission.MANAGE_SETTINGS];

/** `selected` plus the read permission each ticked manage permission needs. */
export function impliedPermissions(selected: ReadonlySet<Permission>): Set<Permission> {
  const result = new Set(selected);
  for (const [permission, needed] of IMPLIES) {
    if (result.has(permission)) result.add(needed);
  }
  return result;
}

/** Ticks or unticks one line the way the API will read it: ticking a manage permission also
 * ticks its read permission, and unticking a read permission unticks what needs it. */
export function toggled(
  selected: ReadonlySet<Permission>,
  permission: Permission,
  on: boolean,
): Set<Permission> {
  const next = new Set(selected);
  if (on) {
    next.add(permission);
    return impliedPermissions(next);
  }
  next.delete(permission);
  for (const [dependent, needed] of IMPLIES) {
    if (needed === permission) next.delete(dependent);
  }
  return next;
}

/** Whether a line may be switched. The editor can only give what they hold themselves, but may
 * leave alone anything the person already has; business settings are never offered. */
export function grantableForEditor(
  editor: ReadonlySet<Permission>,
  targetCurrent: ReadonlySet<Permission>,
): (permission: Permission) => boolean {
  return (permission) =>
    !OWNER_ONLY.includes(permission) && (editor.has(permission) || targetCurrent.has(permission));
}

/** Why a line is locked, or null when it can be changed. */
export function disabledReason(
  editor: ReadonlySet<Permission>,
  targetCurrent: ReadonlySet<Permission>,
  permission: Permission,
): string | null {
  if (OWNER_ONLY.includes(permission)) {
    return "Only an owner can hold this.";
  }
  return grantableForEditor(editor, targetCurrent)(permission)
    ? null
    : "You do not have this access yourself, so you cannot give it.";
}

/** True where the choice differs from what the person's role gives by default. */
export function isCustom(
  permission: Permission,
  selected: ReadonlySet<Permission>,
  defaults: ReadonlySet<Permission>,
): boolean {
  return selected.has(permission) !== defaults.has(permission);
}
