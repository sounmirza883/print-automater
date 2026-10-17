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
 * membership is only ever changed by another owner (the API enforces it,
 * 23.12), so the screen does not offer it to anyone else. */
export function canActOnMember(actorRole: UserRole | null, memberRole: string): boolean {
  return memberRole !== UserRole.SHOP_OWNER || actorRole === UserRole.SHOP_OWNER;
}

/** The API's staff rank (23.12): owner above manager above every other role. */
function rank(role: string | null): number {
  if (role === UserRole.SHOP_OWNER) return 3;
  if (role === UserRole.SHOP_MANAGER) return 2;
  if (
    role === UserRole.SHOP_COUNTER ||
    role === UserRole.OPERATOR ||
    role === UserRole.PRINTER_MANAGER
  ) {
    return 1;
  }
  return 0;
}

/** Whether to offer "Cancel" on a pending invitation: nobody may cancel (or replace) an
 * invitation for a role above their own (the API answers 403 if forced). */
export function canCancelInvite(actorRole: UserRole | null, inviteRole: string): boolean {
  return rank(inviteRole) <= rank(actorRole);
}

/** A rough shape check before sending; the API decides what is a valid address. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The API uses one RATE_LIMITED code for searches and invitations; an invitation's own
 * wording (limits per inviter and per address) reads better than the search one. */
export function withInviteCopy(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { error_code?: unknown }).error_code === "RATE_LIMITED"
  ) {
    return { status: 429, error_code: "INVITE_RATE_LIMITED" };
  }
  return error;
}

export function roleOptions(roles: readonly UserRole[]): Array<{ value: string; label: string }> {
  return roles.map((role) => ({ value: role, label: roleLabel(role) }));
}

/** The branch picker's value for "All branches" (a native select cannot hold null). */
export const ALL_BRANCHES = "";

export function branchLabel(branchName: string | null): string {
  return branchName ?? "All branches";
}

/** What the API takes for the picker's value: null means all branches. */
export function branchToWire(value: string): string | null {
  return value === ALL_BRANCHES ? null : value;
}

/** The branches a person may be put in by this actor (mirrors the API): a branch-bound actor only
 * their own, an owner every active branch plus "All branches", anyone else every active branch.
 * An owner works at all branches by definition, so there is nothing to choose for that role. */
export function branchOptions(
  actor: { role: UserRole | null; branchId: string | null },
  branches: ReadonlyArray<{ id: string; name: string; archivedAt: string | null }>,
  opts: { forRole: string },
): Array<{ value: string; label: string }> {
  if (opts.forRole === UserRole.SHOP_OWNER) {
    return [];
  }
  const own = branches
    .filter((branch) => branch.archivedAt === null)
    .filter((branch) => actor.branchId === null || branch.id === actor.branchId)
    .map((branch) => ({ value: branch.id, label: branch.name }));
  return actor.role === UserRole.SHOP_OWNER
    ? [...own, { value: ALL_BRANCHES, label: "All branches" }]
    : own;
}
