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

// The same limits as the business itself (and as the API): a business's first branch is created
// from its name, address and phone, so the form must accept all of them.
export const BRANCH_NAME_MAX = 200;
export const BRANCH_CITY_MAX = 80;
export const BRANCH_ADDRESS_MAX = 500;
export const BRANCH_PHONE_MAX = 50;

/** What the add/edit dialog checks before sending; the API validates again. */
export function validateBranchForm(form: {
  name: string;
  address: string;
  city?: string;
  phone?: string;
}): { name?: string; address?: string; city?: string; phone?: string } {
  const errors: { name?: string; address?: string; city?: string; phone?: string } = {};
  const name = form.name.trim();
  if (name.length === 0) {
    errors.name = "Give the branch a name.";
  } else if (name.length > BRANCH_NAME_MAX) {
    errors.name = `Keep the name within ${BRANCH_NAME_MAX} characters.`;
  }
  const address = form.address.trim();
  if (address.length === 0) {
    errors.address = "Enter the branch's address.";
  } else if (address.length > BRANCH_ADDRESS_MAX) {
    errors.address = `Keep the address within ${BRANCH_ADDRESS_MAX} characters.`;
  }
  if ((form.city ?? "").trim().length > BRANCH_CITY_MAX) {
    errors.city = `Keep the city within ${BRANCH_CITY_MAX} characters.`;
  }
  if ((form.phone ?? "").trim().length > BRANCH_PHONE_MAX) {
    errors.phone = `Keep the phone number within ${BRANCH_PHONE_MAX} characters.`;
  }
  return errors;
}

/** An edit sends only what the person actually changed, so a field they never touched (a long
 * address copied from the business, say) can never make the save fail. An emptied optional field
 * is sent as null to clear it. */
export function changedBranchFields(
  branch: { name: string; city: string | null; address: string; phone: string | null },
  form: { name: string; city: string; address: string; phone: string },
): { name?: string; city?: string | null; address?: string; phone?: string | null } {
  const changes: { name?: string; city?: string | null; address?: string; phone?: string | null } =
    {};
  const name = form.name.trim();
  if (name !== branch.name) changes.name = name;
  const address = form.address.trim();
  if (address !== branch.address) changes.address = address;
  const city = form.city.trim();
  if (city !== (branch.city ?? "")) changes.city = city === "" ? null : city;
  const phone = form.phone.trim();
  if (phone !== (branch.phone ?? "")) changes.phone = phone === "" ? null : phone;
  return changes;
}
