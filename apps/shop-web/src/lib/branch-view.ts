import { Permission, UserRole } from "@print-automated/types";

/** Pure view logic for the Branches page, kept out of the component so it can be tested without
 * a DOM. The API decides everything; these only choose what to show. */

export type BranchStatus = "open" | "closed" | "archived";

export function branchStatus(branch: { isOpen: boolean; archivedAt: string | null }): BranchStatus {
  if (branch.archivedAt !== null) return "archived";
  return branch.isOpen ? "open" : "closed";
}

/** Who may flip a branch's open/closed switch: an owner (business settings access) or a manager
 * who works at THAT branch. An archived branch is never offered. Mirrors the API's rule. */
export function canOpenClose(
  actor: {
    permissions: ReadonlySet<Permission>;
    role: UserRole | null;
    branchId: string | null;
  },
  branch: { id: string; archivedAt: string | null },
): boolean {
  if (branch.archivedAt !== null) return false;
  if (actor.permissions.has(Permission.MANAGE_SETTINGS)) return true;
  return actor.role === UserRole.SHOP_MANAGER && actor.branchId === branch.id;
}

export const BRANCH_NAME_MAX = 80;

/** What the add/edit dialog checks before sending; the API validates again. */
export function validateBranchForm(form: { name: string; address: string }): {
  name?: string;
  address?: string;
} {
  const errors: { name?: string; address?: string } = {};
  const name = form.name.trim();
  if (name.length === 0) {
    errors.name = "Give the branch a name.";
  } else if (name.length > BRANCH_NAME_MAX) {
    errors.name = `Keep the name within ${BRANCH_NAME_MAX} characters.`;
  }
  if (form.address.trim().length === 0) {
    errors.address = "Enter the branch's address.";
  }
  return errors;
}
