import { UserRole } from "@print-automated/types";
import { roleLabel } from "@/lib/permissions";

/** The roles a person may be given at a business (mirrors the API's
 * SHOP_STAFF_ASSIGNABLE_ROLES). */
export const ASSIGNABLE_ROLES: readonly UserRole[] = [
  UserRole.SHOP_OWNER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_COUNTER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
];

/** What each role can do, in one line, shown beside the picker so nobody
 * hands out more access than they meant to. */
export const ROLE_SUMMARY: Record<string, string> = {
  SHOP_OWNER: "Everything, including business settings and staff.",
  SHOP_MANAGER: "Everything except business settings; cannot make owners.",
  SHOP_COUNTER: "Takes and edits orders and deliveries at the counter.",
  OPERATOR: "Runs production: jobs, quality checks, paper stock (view).",
  PRINTER_MANAGER: "Looks after printers and jobs, reprints, stock (view).",
};

/** Only an existing owner may grant SHOP_OWNER (the API's rule): everyone
 * else is not even offered it. The API still answers 403 if it is forced. */
export function grantableRoles(actorRole: UserRole | null): UserRole[] {
  return ASSIGNABLE_ROLES.filter(
    (role) => role !== UserRole.SHOP_OWNER || actorRole === UserRole.SHOP_OWNER,
  );
}

/** Whether to show change-role / remove on this member's row. An owner's
 * membership is only ever changed by another owner: the API would let a
 * manager demote or remove one, so the screen does not offer it. */
export function canActOnMember(actorRole: UserRole | null, memberRole: string): boolean {
  return memberRole !== UserRole.SHOP_OWNER || actorRole === UserRole.SHOP_OWNER;
}

export function roleOptions(roles: readonly UserRole[]): Array<{ value: string; label: string }> {
  return roles.map((role) => ({ value: role, label: roleLabel(role) }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}
